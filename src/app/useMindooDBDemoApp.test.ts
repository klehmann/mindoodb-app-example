import { effectScope } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MockMindooDBAppSessionController } from "mindoodb-app-sdk/testing";
import { createMockMindooDBAppBridge } from "mindoodb-app-sdk/testing";

import { useMindooDBDemoApp } from "@/app/useMindooDBDemoApp";

let bridgeController: MockMindooDBAppSessionController;

vi.mock("mindoodb-app-sdk", async () => {
  const actual = await vi.importActual<typeof import("mindoodb-app-sdk")>("mindoodb-app-sdk");
  return {
    ...actual,
    createMindooDBAppBridge: () => bridgeController.bridge,
  };
});

describe("useMindooDBDemoApp", () => {
  beforeEach(() => {
    bridgeController = createMockMindooDBAppBridge({
      launchContext: {
        appId: "mindoodb-app-example",
        theme: {
          mode: "dark",
          preset: "mindoo",
        },
        viewport: {
          width: 900,
          height: 600,
        },
      },
      databases: [{
        info: {
          id: "main",
          title: "Main",
          capabilities: ["read", "create", "update", "delete", "history", "attachments"],
        },
        methods: {
          documents: {
            async list() {
              return {
                items: [{ id: "doc-1" }],
                nextCursor: null,
              };
            },
            async get(docId) {
              return {
                id: docId,
                data: {
                  title: "Hello",
                },
              };
            },
            async listHistory() {
              return [];
            },
          },
          attachments: {
            async list() {
              return [];
            },
          },
        },
      }],
    });
  });

  it("connects, loads the first database, and records host events", async () => {
    const scope = effectScope();
    const app = scope.run(() => useMindooDBDemoApp());
    if (!app) {
      throw new Error("Expected the composable to initialize.");
    }

    await app.connect();

    expect(app.launchContext.value?.appId).toBe("mindoodb-app-example");
    expect(app.databases.value).toHaveLength(1);
    expect(app.selectedDatabaseId.value).toBe("main");
    expect(app.selectedDocumentId.value).toBe("doc-1");
    expect(app.editorMode.value).toBe("edit");
    expect(app.editorJson.value).toContain("\"title\": \"Hello\"");
    expect(app.eventLog.value.map((entry) => entry.kind)).toEqual([
      "launch-viewport",
      "launch-theme",
    ]);

    bridgeController.emitThemeChange({
      mode: "light",
      preset: "mindoo",
    });
    bridgeController.emitViewportChange({
      width: 640,
      height: 480,
    });

    expect(app.hostTheme.value.mode).toBe("light");
    expect(app.hostViewport.value).toEqual({
      width: 640,
      height: 480,
    });
    expect(app.eventLog.value[0]?.kind).toBe("viewport-changed");
    expect(app.eventLog.value.some((entry) => entry.kind === "theme-changed")).toBe(true);

    scope.stop();
  });
});
