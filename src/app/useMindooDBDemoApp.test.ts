import { effectScope } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MindooDBAppAttachmentApi, MindooDBAppViewEntry, MindooDBAppViewNavigator } from "mindoodb-app-sdk";
import type { MockMindooDBAppSessionController } from "mindoodb-app-sdk/testing";
import { createMockMindooDBAppBridge } from "mindoodb-app-sdk/testing";

import { useMindooDBDemoApp } from "@/app/useMindooDBDemoApp";

let bridgeController: MockMindooDBAppSessionController;
let openPreview: ReturnType<typeof vi.fn<MindooDBAppAttachmentApi["openPreview"]>>;
let preparePreviewSession: ReturnType<typeof vi.fn<MindooDBAppAttachmentApi["preparePreviewSession"]>>;
let openWriteStream: ReturnType<typeof vi.fn<MindooDBAppAttachmentApi["openWriteStream"]>>;

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
    const uploadedAttachments: Array<{ attachmentId: string; fileName: string; mimeType: string; size: number }> = [];
    openPreview = vi.fn(async () => ({ ok: true as const }));
    preparePreviewSession = vi.fn(async () => ({
      sessionId: "preview-session-1",
      previewUrl: "https://haven.example/attachments/preview/preview-session-1",
    }));
    openWriteStream = vi.fn(async (_docId: string, attachmentName: string, mimeType?: string) => ({
      write: vi.fn(async () => {}),
      close: vi.fn(async () => {
        uploadedAttachments.push({
          attachmentId: `${attachmentName}-id`,
          fileName: attachmentName,
          mimeType: mimeType || "application/octet-stream",
          size: 5,
        });
      }),
      abort: vi.fn(async () => {}),
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
        uiPreferences: {
          iosMultitaskingOptimized: false,
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
              return [...uploadedAttachments];
            },
            preparePreviewSession,
            openPreview,
            openWriteStream,
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
      "launch-ui-preferences",
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
    bridgeController.emitUiPreferencesChange({
      iosMultitaskingOptimized: true,
    });

    expect(app.hostTheme.value.mode).toBe("light");
    expect(app.hostViewport.value).toEqual({
      width: 640,
      height: 480,
    });
    expect(app.hostUiPreferences.value).toEqual({
      iosMultitaskingOptimized: true,
    });
    expect(app.eventLog.value[0]?.kind).toBe("ui-preferences-changed");
    expect(app.eventLog.value[1]?.kind).toBe("viewport-changed");
    expect(app.eventLog.value.some((entry) => entry.kind === "theme-changed")).toBe(true);
    expect(app.eventLog.value.some((entry) => entry.kind === "ui-preferences-changed")).toBe(true);

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

  it("tracks the current navigator entry for dynamic Haven views", async () => {
    const entries: MindooDBAppViewEntry[] = [
      {
        key: "cat-alpha",
        kind: "category",
        origin: "main",
        docId: "category-alpha",
        level: 0,
        parentKey: null,
        categoryPath: ["Alpha"],
        columnValues: { project: "Alpha", title: null },
        descendantDocumentCount: 1,
        childCategoryCount: 0,
        childDocumentCount: 1,
        position: "0",
        expanded: true,
        selected: false,
        isVisible: true,
      },
      {
        key: "doc-1",
        kind: "document",
        origin: "main",
        docId: "doc-1",
        level: 1,
        parentKey: "cat-alpha",
        categoryPath: ["Alpha"],
        columnValues: { project: "Alpha", title: "Hello" },
        descendantDocumentCount: 0,
        childCategoryCount: 0,
        childDocumentCount: 0,
        position: "1",
        expanded: false,
        selected: false,
        isVisible: true,
      },
    ];
    let currentIndex = -1;
    const navigator = {
      async getDefinition() {
        return {
          title: "Tasks by project",
          columns: [],
        };
      },
      async refresh() {},
      async getCurrentEntry() {
        return entries[currentIndex] ?? null;
      },
      async gotoFirst() {
        currentIndex = entries.length ? 0 : -1;
        return currentIndex >= 0;
      },
      async gotoLast() {
        currentIndex = entries.length - 1;
        return currentIndex >= 0;
      },
      async gotoNext() {
        if (currentIndex + 1 >= entries.length) {
          return false;
        }
        currentIndex += 1;
        return true;
      },
      async gotoPrev() {
        if (currentIndex <= 0) {
          return false;
        }
        currentIndex -= 1;
        return true;
      },
      async gotoNextSibling() {
        return false;
      },
      async gotoPrevSibling() {
        return false;
      },
      async gotoParent() {
        if (currentIndex !== 1) {
          return false;
        }
        currentIndex = 0;
        return true;
      },
      async gotoFirstChild() {
        if (currentIndex !== 0) {
          return false;
        }
        currentIndex = 1;
        return true;
      },
      async gotoLastChild() {
        return false;
      },
      async gotoPos(position: string) {
        const index = entries.findIndex((entry) => entry.position === position);
        if (index < 0) {
          return false;
        }
        currentIndex = index;
        return true;
      },
      async getPos(position: string) {
        return entries.find((entry) => entry.position === position) ?? null;
      },
      async findCategoryEntryByParts(parts: unknown[]) {
        return entries.find((entry) => entry.kind === "category" && JSON.stringify(entry.categoryPath) === JSON.stringify(parts)) ?? null;
      },
      async entriesForward() {
        return {
          entries,
          nextPosition: null,
          hasMore: false,
        };
      },
      async entriesBackward() {
        return {
          entries: [...entries].reverse(),
          nextPosition: null,
          hasMore: false,
        };
      },
      async gotoNextSelected() {
        return false;
      },
      async gotoPrevSelected() {
        return false;
      },
      async select() {},
      async deselect() {},
      async selectAllEntries() {},
      async deselectAllEntries() {},
      async isSelected() {
        return false;
      },
      async getSelectionState() {
        return {
          selectAllByDefault: false,
          entryKeys: [],
        };
      },
      async setSelectionState() {},
      async expand() {},
      async collapse() {},
      async expandAll() {},
      async collapseAll() {},
      async expandToLevel() {},
      async isExpanded() {
        return true;
      },
      async getExpansionState() {
        return {
          expandAllByDefault: false,
          expandLevel: 0,
          entryKeys: ["cat-alpha"],
        };
      },
      async setExpansionState() {},
      async childEntries() {
        return [];
      },
      async childCategories() {
        return [];
      },
      async childDocuments() {
        return [];
      },
      async childCategoriesByKey() {
        return [];
      },
      async childDocumentsByKey() {
        return [];
      },
      async childCategoriesBetween() {
        return [];
      },
      async childDocumentsBetween() {
        return [];
      },
      async getSortedDocIds() {
        return [{ origin: "main", docId: "doc-1" }];
      },
      async getSortedDocIdsScoped() {
        return [{ origin: "main", docId: "doc-1" }];
      },
      async dispose() {},
    } satisfies MindooDBAppViewNavigator;

    bridgeController = createMockMindooDBAppBridge({
      launchContext: {
        appId: "mindoodb-app-example",
        views: [{
          id: "tasks-by-project",
          description: "Tasks grouped by project",
          categorizationStyle: "category_then_document",
          previewMode: "tree",
          filter: {
            mode: "formula",
            expression: { kind: "literal", value: true },
          },
          columns: [
            {
              id: "project",
              name: "project",
              title: "Project",
              role: "category",
              expression: { mode: "field", field: "project" },
              sorting: "ascending",
              totalMode: "none",
              hidden: false,
            },
            {
              id: "title",
              name: "title",
              title: "Title",
              role: "display",
              expression: { mode: "field", field: "title" },
              sorting: "ascending",
              totalMode: "none",
              hidden: false,
            },
          ],
          sources: [{
            origin: "main",
            databaseId: "main",
            title: "Main",
            tenantId: "tenant-1",
            databaseName: "Main",
            targetMode: "local",
          }],
        }],
      },
      databases: [{
        info: {
          id: "main",
          title: "Main",
          capabilities: ["read"],
        },
        methods: {
          documents: {
            async list() {
              return { items: [], nextCursor: null };
            },
          },
          views: {
            async open() {
              return navigator;
            },
          },
        },
      }],
    });

    const scope = effectScope();
    const app = scope.run(() => useMindooDBDemoApp());
    if (!app) {
      throw new Error("Expected the composable to initialize.");
    }

    await app.connect();

    expect(app.selectedViewId.value).toBe("tasks-by-project");
    expect(app.viewHasCategories.value).toBe(true);
    expect(app.currentViewEntry.value?.key).toBe("cat-alpha");

    await app.gotoNextViewEntry();
    expect(app.currentViewEntry.value?.key).toBe("doc-1");

    await app.gotoParentViewEntry();
    expect(app.currentViewEntry.value?.key).toBe("cat-alpha");

    await app.gotoFirstChildViewEntry();
    expect(app.currentViewEntry.value?.key).toBe("doc-1");

    await app.focusViewEntry(entries[0]!);
    expect(app.currentViewEntry.value?.key).toBe("cat-alpha");

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

  it("reports the uploaded attachment count from a snapshot instead of a live FileList", async () => {
    const scope = effectScope();
    const app = scope.run(() => useMindooDBDemoApp());
    if (!app) {
      throw new Error("Expected the composable to initialize.");
    }

    await app.connect();

    const backingFiles = [new File(["hello"], "invoice.pdf", { type: "application/pdf" })];
    const liveFileList = {
      get length() {
        return backingFiles.length;
      },
      item(index: number) {
        return backingFiles[index] ?? null;
      },
      [Symbol.iterator]: function *() {
        yield* backingFiles;
      },
    } as unknown as FileList;

    const uploadPromise = app.uploadAttachments(liveFileList);
    backingFiles.splice(0, backingFiles.length);
    await uploadPromise;

    expect(openWriteStream).toHaveBeenCalledWith("doc-1", "invoice.pdf", "application/pdf");
    expect(app.successMessage.value).toBe("Uploaded 1 attachment.");
    expect(app.attachments.value).toEqual([
      expect.objectContaining({
        fileName: "invoice.pdf",
      }),
    ]);

    scope.stop();
  });
});
