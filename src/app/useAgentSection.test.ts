/**
 * The agent's view, end to end: the real bridge talks to the SDK's fake Haven
 * (`createFakeBridgeHost`), the app registers its tools, and the test calls
 * them by the prefixed names an agent sees — including Haven's consent dialog
 * for consequential tools.
 */
import { effectScope } from "vue";
import { createFakeBridgeHost, type FakeBridgeHostController } from "mindoodb-app-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMindooDBDemoApp } from "@/app/useMindooDBDemoApp";

let host: FakeBridgeHostController | null = null;

afterEach(() => {
  host?.dispose();
  host = null;
});

async function launch() {
  host = createFakeBridgeHost({
    launchContext: { appId: "mindoodb-app-example" },
    agentToolPrefix: "example", // as in public/haven-app.json
    databases: [
      {
        info: { id: "sdkexample", title: "SDK Example", capabilities: ["read", "create", "update", "delete"] },
        documents: [{ id: "d1", data: { title: "Quarterly report", status: "open" } }],
      },
    ],
  });
  host.install();
  const app = effectScope().run(() => useMindooDBDemoApp())!;
  await app.connect();
  await vi.waitFor(() => expect(app.exposedToolNames.value.length).toBeGreaterThan(0));
  return { app, agent: host.agent };
}

describe("agent tools through Haven", () => {
  it("offers the tools under the app's prefix and publishes the context", async () => {
    const { app, agent } = await launch();
    expect(agent.exposedNames()).toContain("example_documents_list");
    expect(app.agentToolsEnabled.value).toBe(true);
    await vi.waitFor(() => expect(agent.context()).toMatchObject({ selectedDocId: "d1" }));
  });

  it("shows an agent's new document in the app, and undo takes it back", async () => {
    const { app, agent } = await launch();
    const created = await agent.call("example_document_create", { data: { title: "Kickoff" } });
    expect(created.ok).toBe(true);
    const { docId, undoStepId } = (created as { result: { docId: string; undoStepId: string } }).result;
    expect(app.selectedDocumentId.value).toBe(docId);
    expect(app.agentSteps.value).toHaveLength(1);

    expect((await agent.call("example_undo", { undoStepId })).ok).toBe(true);
    expect(app.documents.value.map((doc) => doc.id)).toEqual(["d1"]);
  });

  it("does not delete when the user declines Haven's confirmation", async () => {
    const { app, agent } = await launch();
    agent.setConsent("deny");
    const outcome = await agent.call("example_document_delete", { docId: "d1" });
    expect(outcome.ok ? null : outcome.error.code).toBe("NOT_ALLOWED");
    expect(app.documents.value.map((doc) => doc.id)).toEqual(["d1"]);
  });
});
