/**
 * The agent tools, called directly: `execute(input)` against the SDK's mock
 * database. No bridge, no Vue — the factory only needs its `deps`.
 */
import { MindooDBAppAgentToolError, type MindooDBAppAgentTool, type MindooDBAppDatabase } from "mindoodb-app-sdk";
import { createMockMindooDBAppSession } from "mindoodb-app-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import { createAgentUndo } from "./agentUndo";
import { createExampleAgentTools, type ExampleAgentDeps } from "./exampleAgentTools";

async function setup(options: { fulltext?: boolean; readOnly?: boolean } = {}) {
  const mock = createMockMindooDBAppSession({
    databases: [
      {
        info: { id: "sdkexample", title: "SDK Example", capabilities: ["read", "create", "update", "delete"] },
        documents: [
          { id: "d1", data: { title: "Quarterly report", status: "open", priority: 1 } },
          { id: "d2", data: { title: "Team offsite", status: "done", priority: 2 } },
          { id: "d3", data: { title: "Report template", status: "open", priority: 2 } },
        ],
        fulltextSetup: options.fulltext ? { enabled: true } : null,
      },
    ],
  });
  const database: MindooDBAppDatabase = await mock.session.openDatabase("sdkexample");
  const afterWrite = vi.fn(async () => undefined);
  const searchUsers = vi.fn(async (): Promise<string[] | null> => null);
  const deps: ExampleAgentDeps = {
    database: () => database,
    context: () => ({ selectedDocId: "d1" }),
    readOnly: () => options.readOnly ?? false,
    decryptionKeyId: () => "default",
    undo: createAgentUndo(),
    afterWrite,
    searchUsers,
  };
  const tools = createExampleAgentTools(deps);
  /** Calls a tool by its own name (without Haven's prefix). */
  const call = async (name: string, input: Record<string, unknown> = {}) => {
    const tool = tools.find((entry) => entry.name === name) as MindooDBAppAgentTool;
    return (await tool.execute(input)) as any;
  };
  return { database, deps, call, afterWrite, searchUsers };
}

/** The error code an agent would see. */
async function errorCode(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error instanceof MindooDBAppAgentToolError ? error.code : "FAILED";
  }
  return "no error";
}

describe("example agent tools", () => {
  it("returns the app context", async () => {
    const { call } = await setup();
    expect(await call("get_context")).toEqual({ selectedDocId: "d1" });
  });

  it("lists documents by exact field values", async () => {
    const { call } = await setup();
    const result = await call("documents_list", { where: { status: "open", priority: 2 } });
    expect(result.total).toBe(1);
    expect(result.documents.map((doc: { docId: string }) => doc.docId)).toEqual(["d3"]);
  });

  it("searches text through the full-text index when it is on", async () => {
    const { call } = await setup({ fulltext: true });
    const result = await call("documents_list", { text: "report" });
    expect(result.textSearch).toBe("full-text index");
    expect(result.documents.map((doc: { docId: string }) => doc.docId).sort()).toEqual(["d1", "d3"]);
    expect(result.documents[0].score).toBeGreaterThan(0);
  });

  it("falls back to a substring match without an index, and says so", async () => {
    const { call } = await setup();
    const result = await call("documents_list", { text: "offsite" });
    expect(result.textSearch).toMatch(/substring/);
    expect(result.documents.map((doc: { docId: string }) => doc.docId)).toEqual(["d2"]);
  });

  it("refuses bad input and unknown ids with codes the agent can act on", async () => {
    const { call } = await setup();
    expect(await errorCode(call("documents_list", { where: { status: ["open"] } }))).toBe("INVALID_INPUT");
    expect(await errorCode(call("document_get", { docId: "nope" }))).toBe("NOT_FOUND");
    expect(await errorCode(call("document_update", { docId: "d1" }))).toBe("INVALID_INPUT");
  });

  it("creates a document and undoes it", async () => {
    const { call, database, afterWrite } = await setup();
    const created = await call("document_create", { data: { title: "Kickoff", status: "planned" } });
    expect(created.data).toEqual({ title: "Kickoff", status: "planned" });
    expect(afterWrite).toHaveBeenCalledWith(created.docId);

    await call("undo", { undoStepId: created.undoStepId });
    expect(await database.documents.get(created.docId)).toBeNull();
  });

  it("updates fields and undo restores the previous data exactly", async () => {
    const { call, database } = await setup();
    const updated = await call("document_update", { docId: "d1", set: { status: "done" }, unset: ["priority"] });
    expect(updated.data).toEqual({ title: "Quarterly report", status: "done" });

    await call("undo"); // without an id: the newest step
    expect((await database.documents.get("d1"))?.data).toEqual({ title: "Quarterly report", status: "open", priority: 1 });
  });

  it("deletes a document and undo brings it back with the same id", async () => {
    const { call, database } = await setup();
    const deleted = await call("document_delete", { docId: "d2" });
    expect(await database.documents.get("d2")).toBeNull();

    await call("undo", { undoStepId: deleted.undoStepId });
    expect((await database.documents.get("d2"))?.data).toMatchObject({ title: "Team offsite" });
  });

  it("refuses to undo over a later change unless forced", async () => {
    const { call, database } = await setup();
    const updated = await call("document_update", { docId: "d1", set: { status: "done" } });
    await database.documents.update("d1", { set: { status: "changed by the user" } });

    expect(await errorCode(call("undo", { undoStepId: updated.undoStepId }))).toBe("STATE_CHANGED");
    await call("undo", { undoStepId: updated.undoStepId, force: true });
    expect((await database.documents.get("d1"))?.data.status).toBe("open");
  });

  it("refuses every write while read-only", async () => {
    const { call } = await setup({ readOnly: true });
    expect(await errorCode(call("document_create", { data: { title: "x" } }))).toBe("NOT_ALLOWED");
    expect(await errorCode(call("document_delete", { docId: "d1" }))).toBe("NOT_ALLOWED");
  });

  it("searches the directory, or explains the missing permission", async () => {
    const { call, searchUsers } = await setup();
    expect(await errorCode(call("users_search", { query: "paul" }))).toBe("NOT_ALLOWED");

    searchUsers.mockResolvedValueOnce(["CN=Paul Meyer/O=Acme"]);
    expect(await call("users_search", { query: "paul", limit: 5 })).toEqual({ users: ["CN=Paul Meyer/O=Acme"] });
    expect(searchUsers).toHaveBeenLastCalledWith("paul", 5);
  });
});
