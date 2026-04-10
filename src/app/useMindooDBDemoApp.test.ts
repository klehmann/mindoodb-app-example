import { effectScope } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MindooDBAppAttachmentApi } from "mindoodb-app-sdk";
import type { MockMindooDBAppSessionController } from "mindoodb-app-sdk/testing";
import { createMockMindooDBAppBridge } from "mindoodb-app-sdk/testing";

import { useMindooDBDemoApp } from "@/app/useMindooDBDemoApp";

let bridgeController: MockMindooDBAppSessionController;
let openPreview: ReturnType<typeof vi.fn<MindooDBAppAttachmentApi["openPreview"]>>;
let preparePreviewSession: ReturnType<typeof vi.fn<MindooDBAppAttachmentApi["preparePreviewSession"]>>;

vi.mock("mindoodb-app-sdk", async () => {
  const actual = await vi.importActual<typeof import("mindoodb-app-sdk")>("mindoodb-app-sdk");
  return {
    ...actual,
    canPreviewAttachment: actual.canPreviewAttachment ?? (() => null),
    createMindooDBAppBridge: () => bridgeController.bridge,
  };
});

describe("useMindooDBDemoApp", () => {
  beforeEach(() => {
    openPreview = vi.fn(async () => ({ ok: true as const }));
    preparePreviewSession = vi.fn(async () => ({
      sessionId: "preview-session-1",
      previewUrl: "https://haven.example/attachments/preview/preview-session-1",
    }));
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
            preparePreviewSession,
            openPreview,
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

  it("opens the Haven attachment preview through the SDK when embedded", async () => {
    const scope = effectScope();
    const app = scope.run(() => useMindooDBDemoApp());
    if (!app) {
      throw new Error("Expected the composable to initialize.");
    }

    await app.connect();
    await app.previewAttachment("invoice.pdf");

    expect(openPreview).toHaveBeenCalledWith("doc-1", "invoice.pdf");
    expect(preparePreviewSession).not.toHaveBeenCalled();

    scope.stop();
  });

  it("opens a dedicated Haven preview tab when running in a window", async () => {
    bridgeController = createMockMindooDBAppBridge({
      launchContext: {
        appId: "mindoodb-app-example",
        runtime: "window",
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
            preparePreviewSession,
            openPreview,
          },
        },
      }],
    });

    const popup = {
      document: { title: "" },
      location: { href: "" },
      close: vi.fn(),
    } as unknown as Window;
    const openSpy = vi.spyOn(window, "open").mockReturnValue(popup);

    const scope = effectScope();
    const app = scope.run(() => useMindooDBDemoApp());
    if (!app) {
      throw new Error("Expected the composable to initialize.");
    }

    await app.connect();
    await app.previewAttachment("invoice.pdf");

    expect(openSpy).toHaveBeenCalledWith("", "_blank");
    expect(preparePreviewSession).toHaveBeenCalledWith("doc-1", "invoice.pdf");
    expect(popup.location.href).toBe("https://haven.example/attachments/preview/preview-session-1");
    expect(openPreview).not.toHaveBeenCalled();

    scope.stop();
    openSpy.mockRestore();
  });
});
