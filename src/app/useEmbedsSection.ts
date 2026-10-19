/**
 * "Embedded editors" tab: Word documents, spreadsheets and presentations edited by
 * TeamEdit, TeamGrid and TeamSlides *inside* this app, stored in this app's own
 * database (`sdkexample`).
 *
 * The example never reads or writes the content of these documents. It only
 *
 * 1. finds the editors (`session.components.list`) and asks the user once for all
 *    of them (`session.embeds.requestAccess`),
 * 2. creates an empty root document with the component's `createFields`,
 * 3. shows the editor in an element of its page (`session.embeds.open`). Haven
 *    copies the root and its children into a sandbox, launches the editor's app
 *    on it and writes every change back to `sdkexample`,
 * 4. lists the root documents with a live query, so titles the user changes in the
 *    editor show up by themselves,
 * 5. asks the editor to save, or asks the user about unsaved changes before closing,
 * 6. deletes a document together with its children.
 *
 * See README "Embedding TeamEdit, TeamGrid and TeamSlides" and the SDK README
 * section "Components: embedding another app's editor".
 *
 * @module useEmbedsSection
 */
import { computed, ref, type Ref } from "vue";
import type {
  MindooDBAppComponentInfo,
  MindooDBAppDatabase,
  MindooDBAppEmbed,
  MindooDBAppLaunchContext,
  MindooDBAppLiveQuerySubscription,
  MindooDBAppSession,
} from "mindoodb-app-sdk";

import {
  CHILDREN_FIELD,
  childrenFilter,
  describeOpenError,
  EDITOR_FIELD,
  editorSpec,
  EMBEDDED_EDITORS,
  EMBEDS_DATABASE_ID,
  embeddedDocumentsFilter,
  findComponent,
  newDocumentFields,
  readChildren,
  TITLE_FIELD,
  type EmbeddedEditorKind,
  type EmbeddedEditorSpec,
} from "@/features/embeds/lib/embeddedEditors";
import { t } from "@/i18n";

/**
 * Whether the user let the editor see this app's documents:
 * `granted`: `embeds.open` shows it without asking;
 * `pending`: the user unticked it or chose "Not now"; Haven asks again on open;
 * `unknown`: this Haven predates `requestAccess`; Haven asks on open.
 */
export type EmbeddedEditorAccess = "granted" | "pending" | "unknown";

export interface EmbeddedEditorStatus extends EmbeddedEditorSpec {
  /** The installed component, or null when its app is not installed. */
  component: MindooDBAppComponentInfo | null;
  access: EmbeddedEditorAccess;
}

export interface EmbeddedDocumentRow {
  docId: string;
  kind: EmbeddedEditorKind;
  title: string;
}

/** What closing the open editor did; `confirm`: it has unsaved changes, ask the user. */
export type CloseResult = "closed" | "confirm" | "failed";

/** How many embedded documents the list shows (Haven caps a query page at 1000). */
const LIST_LIMIT = 500;
/** Page size for collecting and deleting a document's children. */
const CHILD_PAGE = 500;

export function useEmbedsSection(session: Ref<MindooDBAppSession | null>) {
  // ── State the UI binds to ──────────────────────────────────────────
  const editors = ref<EmbeddedEditorStatus[]>(
    EMBEDDED_EDITORS.map((spec) => ({ ...spec, component: null, access: "unknown" })),
  );
  /** False when this Haven (or SDK) cannot embed components at all. */
  const embedsSupported = ref(true);
  const canEdit = ref(false);
  const embeddedDocuments = ref<EmbeddedDocumentRow[]>([]);
  /** The document shown in the editor panel. */
  const openDocId = ref<string | null>(null);
  /** What the open editor last reported; `undefined` while it has not said. */
  const openDirty = ref<boolean | undefined>(undefined);
  const notice = ref<string | null>(null);
  const busy = ref(false);

  const openDocument = computed(() => embeddedDocuments.value.find((row) => row.docId === openDocId.value) ?? null);

  // ── SDK objects: kept out of Vue's reactivity on purpose ───────────
  let database: MindooDBAppDatabase | null = null;
  let subscription: MindooDBAppLiveQuerySubscription | null = null;
  /** The open editor (only one at a time in this demo). */
  let embed: MindooDBAppEmbed | null = null;
  /** Whether the tab with the editor panel is in front. */
  let panelVisible = true;

  function statusOf(kind: EmbeddedEditorKind) {
    return editors.value.find((entry) => entry.kind === kind)!;
  }

  // ── Setup and teardown ─────────────────────────────────────────────

  /** Called by the root composable once the session is connected. */
  async function install(nextSession: MindooDBAppSession, launchContext: MindooDBAppLaunchContext) {
    await teardown();
    const info = launchContext.databases.find((entry) => entry.id === EMBEDS_DATABASE_ID);
    if (!info) {
      notice.value = t("embedsNotMapped", { database: EMBEDS_DATABASE_ID });
      return;
    }
    // Editing needs `update`; time travel launches are read-only.
    canEdit.value = info.capabilities.includes("update") && launchContext.timeTravelDate == null;
    database = await nextSession.openDatabase(EMBEDS_DATABASE_ID);
    await loadComponents(nextSession);
    await requestAccess();
    subscription = await database.documents.liveQuery(
      {
        filter: embeddedDocumentsFilter(),
        fields: [EDITOR_FIELD, TITLE_FIELD],
        sortBy: [{ field: TITLE_FIELD, direction: "ascending" }],
        limit: LIST_LIMIT,
      },
      (result) => {
        embeddedDocuments.value = result.rows.flatMap((row) => {
          const spec = editorSpec(row.fields[EDITOR_FIELD]);
          const title = row.fields[TITLE_FIELD];
          return spec ? [{ docId: row.docId, kind: spec.kind, title: typeof title === "string" ? title : "" }] : [];
        });
      },
    );
  }

  async function teardown() {
    await subscription?.dispose().catch(() => {});
    subscription = null;
    // Leaving the app: let the editor save what it has, as it would on its own.
    await embed?.close().catch(() => {});
    embed = null;
    openDocId.value = null;
    database = null;
  }

  /**
   * Which of the three editors are installed. Havens before embedded components
   * answer `method-not-found`; the tab then explains that instead of failing.
   */
  async function loadComponents(nextSession: MindooDBAppSession) {
    try {
      const components = await nextSession.components.list({ intent: "create" });
      embedsSupported.value = true;
      editors.value = EMBEDDED_EDITORS.map((spec) => ({
        ...spec,
        component: findComponent(components, spec),
        access: "unknown",
      }));
    } catch (cause) {
      console.warn("Embedded components are not available on this Haven host.", cause);
      embedsSupported.value = false;
    }
  }

  /**
   * Asks the user once, in one dialog, for every installed editor, instead of once
   * per editor when its first document opens. Haven leaves out what the user
   * already allowed or put off, so calling this on every start is fine.
   */
  async function requestAccess() {
    const installed = editors.value.filter((entry) => entry.component);
    if (!session.value || !installed.length || !canEdit.value) {
      return;
    }
    try {
      const { granted, pending } = await session.value.embeds.requestAccess({
        components: installed.map((entry) => ({ componentKey: entry.component!.key, databaseIds: [EMBEDS_DATABASE_ID] })),
      });
      for (const entry of installed) {
        const key = entry.component!.key;
        entry.access = granted.some((pair) => pair.componentKey === key)
          ? "granted"
          : pending.some((pair) => pair.componentKey === key)
            ? "pending"
            : "unknown";
      }
    } catch (cause) {
      // Havens before `requestAccess`: `embeds.open` asks instead.
      console.warn("Could not ask for the editors up front.", cause);
    }
  }

  // ── Creating, opening, saving, closing ─────────────────────────────

  /**
   * Creates an empty document for `kind` and opens it in `container`. The editor
   * fills the empty root (e.g. TeamEdit adds its first chunk) when it starts.
   */
  async function createDocument(kind: EmbeddedEditorKind, title: string, container: HTMLElement) {
    const status = statusOf(kind);
    if (!database || !status.component) {
      return;
    }
    if ((await closeEditor("ask")) !== "closed") {
      return;
    }
    const created = await database.documents.create({ set: newDocumentFields(status.component, status, title) });
    // The live query lists it a moment later; open it right away.
    await showEditor(created.id, status, container);
  }

  /** Shows `docId` in its editor inside `container` (a positioned element). */
  async function openInEditor(docId: string, container: HTMLElement): Promise<CloseResult> {
    if (!session.value || openDocId.value === docId) {
      return "closed";
    }
    // One editor at a time: the previous one must be closed first.
    const closed = await closeEditor("ask");
    if (closed !== "closed") {
      return closed;
    }
    const row = embeddedDocuments.value.find((entry) => entry.docId === docId);
    if (!row) {
      return "failed";
    }
    return await showEditor(docId, statusOf(row.kind), container);
  }

  async function showEditor(docId: string, status: EmbeddedEditorStatus, container: HTMLElement): Promise<CloseResult> {
    if (!session.value || !status.component) {
      notice.value = t("editorAppNotInstalled", { app: status.appName });
      return "failed";
    }
    notice.value = null;
    busy.value = true;
    openDocId.value = docId;
    try {
      // The SDK puts a frame into `container`; Haven loads the editor into it.
      // When access is still pending, Haven asks the user now (or rejects with `declined`).
      const opened = await session.value.embeds.open({
        componentKey: status.component.key,
        databaseId: EMBEDS_DATABASE_ID,
        docId,
        intent: canEdit.value ? "edit" : "view",
        container,
        visible: panelVisible,
      });
      embed = opened;
      status.access = "granted";
      openDirty.value = opened.dirty;
      opened.onDirtyChange((dirty) => {
        if (embed === opened) openDirty.value = dirty;
      });
      // "Done" / "Cancel" in the editor, or Haven closing it: the panel empties.
      opened.onClosed((event) => {
        if (embed !== opened) return;
        embed = null;
        openDocId.value = null;
        openDirty.value = undefined;
        if (event.reason === "error") {
          notice.value = t("editorClosedWithError", { message: event.message ?? t("unknownError") });
        }
      });
      return "closed";
    } catch (cause) {
      openDocId.value = null;
      notice.value = describeOpenError(cause, status);
      return "failed";
    } finally {
      busy.value = false;
    }
  }

  /** Asks the open editor to save. Rejects with the editor's error (or `unsupported`). */
  async function saveEditor() {
    if (!embed) {
      return;
    }
    try {
      await embed.save();
      notice.value = null;
    } catch (cause) {
      notice.value = t("savingFailed", { message: cause instanceof Error ? cause.message : String(cause) });
    }
  }

  /**
   * Closes the open editor. With `ask`, an editor with unsaved changes stays open
   * and `confirm` comes back, so the UI can offer Save / Don't save / Cancel and
   * call again with `save` or `discard`.
   */
  async function closeEditor(mode: "ask" | "save" | "discard" = "ask"): Promise<CloseResult> {
    const current = embed;
    if (!current) {
      openDocId.value = null;
      return "closed";
    }
    // `dirty` is undefined for editors that never report it: close those without asking.
    if (mode === "ask" && current.dirty === true) {
      return "confirm";
    }
    if (mode === "save") {
      try {
        await current.save();
      } catch (cause) {
        notice.value = t("savingFailedStaysOpen", {
          message: cause instanceof Error ? cause.message : String(cause),
        });
        return "failed";
      }
    }
    embed = null;
    openDocId.value = null;
    openDirty.value = undefined;
    // Without `discard` the editor may still flush its last edits before it goes.
    await current.close(mode === "discard" ? { discard: true } : undefined).catch(() => {});
    return "closed";
  }

  /** The tab went behind another one (or came back): hide the editor without closing it. */
  async function setEditorVisible(visible: boolean) {
    panelVisible = visible;
    await embed?.setVisible(visible).catch(() => {});
  }

  // ── Renaming and deleting ──────────────────────────────────────────

  /**
   * Renames a closed document. While a document is open its editor owns it (it
   * writes `subject` itself on save), so rename it there; the live query shows the
   * new title either way.
   */
  async function renameDocument(docId: string, title: string) {
    if (!database || docId === openDocId.value) {
      return;
    }
    const document = await database.documents.get(docId);
    const set: Record<string, unknown> = { [TITLE_FIELD]: title };
    // TeamSlides keeps a second title field; keep both in step.
    if (document && typeof document.data.title === "string") {
      set.title = title;
    }
    await database.documents.update(docId, { set });
  }

  /**
   * Deletes a document and its children (the chunks of a Word document, the slides
   * of a presentation). The editor is closed first so it cannot write the document
   * back; children go before the root, so an interrupted delete can be repeated.
   */
  async function deleteDocument(docId: string) {
    if (!database) {
      return;
    }
    if (docId === openDocId.value) {
      await closeEditor("discard");
    }
    const document = await database.documents.get(docId);
    // The link stored at creation, else the one the installed editor declares.
    const status = editorSpec(document?.data[EDITOR_FIELD]);
    const children =
      readChildren(document?.data[CHILDREN_FIELD]) ?? (status ? statusOf(status.kind).component?.children ?? null : null);
    if (children) {
      const childIds = new Set<string>();
      for (let offset = 0; ; offset += CHILD_PAGE) {
        const page = await database.documents.query({
          filter: childrenFilter(children, docId),
          fields: [children.linkField],
          limit: CHILD_PAGE,
          offset,
        });
        page.rows.forEach((row) => row.docId !== docId && childIds.add(row.docId));
        if (page.rows.length < CHILD_PAGE) break;
      }
      const ids = [...childIds];
      for (let index = 0; index < ids.length; index += CHILD_PAGE) {
        await database.documents.deleteMany(ids.slice(index, index + CHILD_PAGE));
      }
    }
    await database.documents.delete(docId);
  }

  return {
    editors,
    embedsSupported,
    canEdit,
    embeddedDocuments,
    openDocId,
    openDocument,
    openDirty,
    notice,
    busy,
    install,
    teardown,
    requestAccess,
    createDocument,
    openInEditor,
    saveEditor,
    closeEditor,
    setEditorVisible,
    renameDocument,
    deleteDocument,
  };
}
