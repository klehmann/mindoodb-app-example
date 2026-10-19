/**
 * The "Embedded editors" tab against the SDK's mock Haven: which editors are
 * installed, asking for all of them at once, creating and opening a document,
 * unsaved changes, renames, deleting with children, and what happens when an
 * editor is missing or the user declines.
 *
 * There is no second app in a test: the mock records each embed (`listEmbeds`) and
 * plays the editor with `setEmbedDirty`, `failNextEmbedSave` and `closeEmbed`.
 */
import { flushPromises } from "@vue/test-utils";
import type { MindooDBAppDefinition } from "mindoodb-app-sdk";
import {
  createMockMindooDBAppSession,
  mockDatabasesFromDefinition,
  type CreateMockMindooDBAppSessionOptions,
} from "mindoodb-app-sdk/testing";
import { describe, expect, it } from "vitest";
import { ref } from "vue";

import appDefinition from "../../public/haven-app.json";
import { useEmbedsSection } from "@/app/useEmbedsSection";
import { seedComponents } from "@/testHost/seed";

async function setup(options: Partial<CreateMockMindooDBAppSessionOptions> = {}) {
  const mock = createMockMindooDBAppSession({
    launchContext: { appId: appDefinition.appId },
    databases: mockDatabasesFromDefinition(appDefinition as MindooDBAppDefinition, { sdkexample: [] }),
    components: seedComponents,
    ...options,
  });
  const session = ref(mock.session);
  const embeds = useEmbedsSection(session);
  await embeds.install(mock.session, await mock.session.getLaunchContext());
  const db = await mock.session.openDatabase("sdkexample");
  const container = document.createElement("div");
  document.body.appendChild(container);
  return { mock, embeds, db, container };
}

/** Lets the live query deliver. */
async function settle() {
  for (let index = 0; index < 3; index += 1) {
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("useEmbedsSection", () => {
  it("finds the three editors and asks for all of them in one request", async () => {
    const { mock, embeds } = await setup();
    expect(embeds.editors.value.map((editor) => [editor.kind, editor.component?.key, editor.access])).toEqual([
      ["word", "teamedit/word", "granted"],
      ["spreadsheet", "teamgrid/spreadsheet", "granted"],
      ["presentation", "teamslides/presentation", "granted"],
    ]);
    expect(mock.getEmbedAccessRequests()).toEqual([
      {
        components: [
          { componentKey: "teamedit/word", databaseIds: ["sdkexample"] },
          { componentKey: "teamgrid/spreadsheet", databaseIds: ["sdkexample"] },
          { componentKey: "teamslides/presentation", databaseIds: ["sdkexample"] },
        ],
      },
    ]);
  });

  it("marks editors the user did not allow and ones that are not installed", async () => {
    const { embeds } = await setup({
      components: seedComponents.filter((component) => component.componentId !== "spreadsheet"),
      // The user unticks TeamSlides in Haven's dialog.
      embedAccess: (pairs) => pairs.filter((pair) => pair.componentKey !== "teamslides/presentation"),
    });
    expect(embeds.editors.value.map((editor) => [editor.kind, editor.component !== null, editor.access])).toEqual([
      ["word", true, "granted"],
      ["spreadsheet", false, "unknown"],
      ["presentation", true, "pending"],
    ]);
  });

  it("creates a document with the component's fields and opens it in the container", async () => {
    const { mock, embeds, db, container } = await setup();
    await embeds.createDocument("word", "Offer 2027", container);
    await settle();

    const [embed] = mock.listEmbeds();
    expect(embed).toMatchObject({ databaseId: "sdkexample", intent: "edit", component: { key: "teamedit/word" } });
    const root = await db.documents.get(embed!.docId);
    expect(root?.data).toMatchObject({
      form: "teamedit",
      type: "word",
      subject: "Offer 2027",
      exampleEditor: "word",
      exampleChildren: { linkField: "parentId", match: { type: "wordChunk" } },
    });
    expect(embeds.openDocId.value).toBe(embed!.docId);
    expect(embeds.embeddedDocuments.value).toEqual([{ docId: embed!.docId, kind: "word", title: "Offer 2027" }]);
  });

  it("follows titles the editor writes, and renames closed documents itself", async () => {
    const { embeds, db, container } = await setup();
    await embeds.createDocument("presentation", "Kick-off", container);
    await settle();
    const docId = embeds.openDocId.value!;

    // The editor saves a new title into the root document; the list follows.
    await db.documents.update(docId, { set: { subject: "Kick-off 2027" } });
    await settle();
    expect(embeds.embeddedDocuments.value[0]?.title).toBe("Kick-off 2027");

    // While it is open the editor owns the title: the host does not rename.
    await embeds.renameDocument(docId, "Ignored");
    expect((await db.documents.get(docId))?.data.subject).toBe("Kick-off 2027");

    await embeds.closeEditor();
    await embeds.renameDocument(docId, "Final deck");
    await settle();
    // TeamSlides keeps `title` too; both follow.
    expect((await db.documents.get(docId))?.data).toMatchObject({ subject: "Final deck", title: "Final deck" });
    expect(embeds.embeddedDocuments.value[0]?.title).toBe("Final deck");
  });

  it("asks before closing an editor with unsaved changes and keeps it open when saving fails", async () => {
    const { mock, embeds, container } = await setup();
    await embeds.createDocument("spreadsheet", "Budget", container);
    const [embed] = mock.listEmbeds();

    mock.setEmbedDirty(embed!.embedId, true);
    expect(embeds.openDirty.value).toBe(true);
    expect(await embeds.closeEditor("ask")).toBe("confirm");
    expect(mock.listEmbeds()).toHaveLength(1);

    mock.failNextEmbedSave("Disk full");
    expect(await embeds.closeEditor("save")).toBe("failed");
    expect(embeds.notice.value).toContain("Disk full");
    expect(mock.listEmbeds()).toHaveLength(1);

    expect(await embeds.closeEditor("discard")).toBe("closed");
    expect(mock.listEmbeds()).toEqual([]);
    expect(embeds.openDocId.value).toBeNull();
  });

  it("empties the panel when the editor closes itself (Done)", async () => {
    const { mock, embeds, container } = await setup();
    await embeds.createDocument("word", "Memo", container);
    mock.closeEmbed(mock.listEmbeds()[0]!.embedId, "completed", { subject: "Memo" });
    await settle();
    expect(embeds.openDocId.value).toBeNull();
  });

  it("deletes a document with its children", async () => {
    const { embeds, db, container } = await setup();
    await embeds.createDocument("word", "Letter", container);
    const docId = embeds.openDocId.value!;
    // What TeamEdit would write: chunks pointing at the root.
    const chunk = await db.documents.create({ set: { type: "wordChunk", parentId: docId, index: 0 } });
    const other = await db.documents.create({ set: { type: "wordChunk", parentId: "someone-else" } });

    await embeds.deleteDocument(docId);
    await settle();
    expect(await db.documents.get(docId)).toBeNull();
    expect(await db.documents.get(chunk.id)).toBeNull();
    expect(await db.documents.get(other.id)).not.toBeNull();
    expect(embeds.embeddedDocuments.value).toEqual([]);
    expect(embeds.openDocId.value).toBeNull();
  });

  it("explains why a document cannot be opened", async () => {
    const { mock, embeds, db, container } = await setup();
    const created = await db.documents.create({ set: { form: "teamgrid-next", subject: "Old sheet", exampleEditor: "spreadsheet" } });
    await settle();

    // The user declines Haven's question when the editor is about to open.
    const open = mock.session.embeds.open;
    mock.session.embeds.open = async () => {
      throw Object.assign(new Error("The user did not allow this component."), { name: "declined" });
    };
    expect(await embeds.openInEditor(created.id, container)).toBe("failed");
    expect(embeds.notice.value).toContain("did not allow TeamGrid");
    mock.session.embeds.open = open;

    // TeamGrid was uninstalled: the document is still listed, but cannot open.
    mock.setComponents(seedComponents.filter((component) => component.componentId !== "spreadsheet"));
    await embeds.install(mock.session, await mock.session.getLaunchContext());
    await settle();
    expect(embeds.embeddedDocuments.value.map((row) => row.title)).toEqual(["Old sheet"]);
    expect(await embeds.openInEditor(created.id, container)).toBe("failed");
    expect(embeds.notice.value).toContain("TeamGrid is not installed");
  });

  it("explains a Haven without embedded components", async () => {
    const mock = createMockMindooDBAppSession({
      launchContext: { appId: appDefinition.appId },
      databases: mockDatabasesFromDefinition(appDefinition as MindooDBAppDefinition, { sdkexample: [] }),
    });
    mock.session.components.list = async () => {
      throw Object.assign(new Error("Unknown method"), { name: "method-not-found" });
    };
    const embeds = useEmbedsSection(ref(mock.session));
    await embeds.install(mock.session, await mock.session.getLaunchContext());
    expect(embeds.embedsSupported.value).toBe(false);
    expect(embeds.editors.value.every((editor) => editor.component === null)).toBe(true);
  });
});
