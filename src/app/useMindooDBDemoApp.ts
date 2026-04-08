import { computed, onBeforeUnmount, ref } from "vue";
import {
  canPreviewAttachment,
  createMindooDBAppBridge,
  type MindooDBAppAttachmentInfo,
  type MindooDBAppDatabase,
  type MindooDBAppDatabaseInfo,
  type MindooDBAppDocument,
  type MindooDBAppDocumentHistoryEntry,
  type MindooDBAppHistoricalDocument,
  type MindooDBAppHostTheme,
  type MindooDBAppLaunchContext,
  type MindooDBAppSession,
  type MindooDBAppViewport,
  type MindooDBAppViewExpansionState,
  type MindooDBAppViewHandle,
  type MindooDBAppViewPageResult,
  type MindooDBAppViewRow,
} from "mindoodb-app-sdk";

import { applyAppTheme, normalizeAppTheme } from "@/lib/theme";
import { getVisibleViewColumns } from "@/features/views/lib/runtimeViews";

export type DemoEventEntry = {
  id: string;
  kind: "launch-theme" | "launch-viewport" | "theme-changed" | "viewport-changed";
  createdAt: string;
  label: string;
  payload: string;
};

function addEventEntry(target: DemoEventEntry[], entry: Omit<DemoEventEntry, "id" | "createdAt">) {
  target.unshift({
    ...entry,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  });
  target.splice(40);
}

function stringifyJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function readAttachmentBlob(database: MindooDBAppDatabase, docId: string, attachmentName: string) {
  const stream = await database.attachments.openReadStream(docId, attachmentName);
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await stream.read();
      if (!chunk) {
        break;
      }
      chunks.push(chunk);
    }
  } finally {
    await stream.close();
  }

  return new Blob(chunks.map((chunk) => Uint8Array.from(chunk)));
}

export function useMindooDBDemoApp() {
  const session = ref<MindooDBAppSession | null>(null);
  const launchContext = ref<MindooDBAppLaunchContext | null>(null);
  const databases = ref<MindooDBAppDatabaseInfo[]>([]);
  const selectedDatabaseId = ref<string | null>(null);
  const selectedDatabase = ref<MindooDBAppDatabase | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const successMessage = ref<string | null>(null);
  const hostTheme = ref(normalizeAppTheme());
  const hostViewport = ref<MindooDBAppViewport | null>(null);
  const eventLog = ref<DemoEventEntry[]>([]);

  const documents = ref<MindooDBAppDocument[]>([]);
  const selectedDocumentId = ref<string | null>(null);
  const editorJson = ref("{\n}");
  const editorMode = ref<"create" | "edit">("create");
  const historyEntries = ref<MindooDBAppDocumentHistoryEntry[]>([]);
  const selectedHistoricalDocument = ref<MindooDBAppHistoricalDocument | null>(null);
  const historyMessage = ref<string | null>(null);
  const attachments = ref<MindooDBAppAttachmentInfo[]>([]);
  const attachmentMessage = ref<string | null>(null);
  const busyAction = ref<string | null>(null);

  const selectedViewId = ref<string | null>(null);
  const viewRows = ref<MindooDBAppViewPageResult["rows"]>([]);
  const viewExpansionState = ref<MindooDBAppViewExpansionState | null>(null);
  const viewMessage = ref<string | null>(null);
  const currentViewHandle = ref<MindooDBAppViewHandle | null>(null);

  let stopThemeSync: (() => void) | null = null;
  let stopViewportSync: (() => void) | null = null;

  const selectedDatabaseInfo = computed(() =>
    databases.value.find((database) => database.id === selectedDatabaseId.value) ?? null,
  );
  const selectedDocument = computed(() =>
    documents.value.find((document) => document.id === selectedDocumentId.value) ?? null,
  );
  const availableViews = computed(() => launchContext.value?.views ?? []);
  const selectedView = computed(() =>
    availableViews.value.find((view) => view.id === selectedViewId.value) ?? null,
  );
  const visibleViewColumns = computed(() =>
    selectedView.value ? getVisibleViewColumns(selectedView.value) : [],
  );
  const canCreate = computed(() => selectedDatabaseInfo.value?.capabilities.includes("create") ?? false);
  const canUpdate = computed(() => selectedDatabaseInfo.value?.capabilities.includes("update") ?? false);
  const canDelete = computed(() => selectedDatabaseInfo.value?.capabilities.includes("delete") ?? false);
  const canBrowseHistory = computed(() => selectedDatabaseInfo.value?.capabilities.includes("history") ?? false);
  const canUseAttachments = computed(() => selectedDatabaseInfo.value?.capabilities.includes("attachments") ?? false);
  const canRead = computed(() => selectedDatabaseInfo.value?.capabilities.includes("read") ?? false);
  const isBusy = computed(() => Boolean(busyAction.value) || loading.value);

  function setSuccess(message: string | null) {
    successMessage.value = message;
    if (message) {
      error.value = null;
    }
  }

  function applyHostTheme(theme?: MindooDBAppHostTheme | null, kind: DemoEventEntry["kind"] = "theme-changed") {
    hostTheme.value = applyAppTheme(theme);
    addEventEntry(eventLog.value, {
      kind,
      label: kind === "launch-theme" ? "Initial theme" : "Theme changed",
      payload: stringifyJson(theme ?? hostTheme.value),
    });
  }

  function setViewport(viewport: MindooDBAppViewport | null, kind: DemoEventEntry["kind"] = "viewport-changed") {
    hostViewport.value = viewport;
    addEventEntry(eventLog.value, {
      kind,
      label: kind === "launch-viewport" ? "Initial viewport" : "Viewport changed",
      payload: stringifyJson(viewport),
    });
  }

  function resetDatabasePanels() {
    historyEntries.value = [];
    selectedHistoricalDocument.value = null;
    historyMessage.value = null;
    attachments.value = [];
    attachmentMessage.value = null;
  }

  function startCreateDocument() {
    editorMode.value = "create";
    selectedDocumentId.value = null;
    editorJson.value = "{\n}";
    resetDatabasePanels();
    setSuccess(null);
  }

  function selectDocument(docId: string | null) {
    selectedDocumentId.value = docId;
    const document = selectedDocument.value;
    if (!document) {
      startCreateDocument();
      return;
    }
    editorMode.value = "edit";
    editorJson.value = stringifyJson(document.data);
    historyMessage.value = null;
    attachmentMessage.value = null;
  }

  async function refreshDocuments(preferredDocId?: string | null) {
    if (!selectedDatabase.value || !selectedDatabaseId.value || !canRead.value) {
      documents.value = [];
      startCreateDocument();
      return;
    }

    const list = await selectedDatabase.value.documents.list({ limit: 100 });
    const loaded = await Promise.all(
      list.items.map(async (item) => await selectedDatabase.value!.documents.get(item.id)),
    );
    documents.value = loaded.filter((item): item is MindooDBAppDocument => Boolean(item));

    const nextDocId = preferredDocId && documents.value.some((item) => item.id === preferredDocId)
      ? preferredDocId
      : documents.value[0]?.id ?? null;
    if (nextDocId) {
      selectDocument(nextDocId);
      await refreshAttachments();
    } else {
      startCreateDocument();
    }
  }

  async function refreshAttachments() {
    attachments.value = [];
    attachmentMessage.value = null;
    if (!selectedDatabase.value || !selectedDocumentId.value) {
      return;
    }
    if (!canUseAttachments.value) {
      attachmentMessage.value = "Attachment access is not allowed for the selected database.";
      return;
    }

    attachments.value = await selectedDatabase.value.attachments.list(selectedDocumentId.value);
  }

  async function loadHistory(timestamp?: number) {
    selectedHistoricalDocument.value = null;
    historyMessage.value = null;
    if (!selectedDatabase.value || !selectedDocumentId.value) {
      return;
    }
    if (!canBrowseHistory.value) {
      historyEntries.value = [];
      historyMessage.value = "History browsing is not allowed for the selected database.";
      return;
    }

    historyEntries.value = await selectedDatabase.value.documents.listHistory(selectedDocumentId.value);
    if (!historyEntries.value.length) {
      historyMessage.value = "No historical revisions were found for the selected document.";
      return;
    }

    const nextTimestamp = timestamp ?? historyEntries.value[0]?.timestamp;
    if (nextTimestamp == null) {
      return;
    }
    selectedHistoricalDocument.value = await selectedDatabase.value.documents.getAtTimestamp(
      selectedDocumentId.value,
      nextTimestamp,
    );
  }

  async function connect() {
    loading.value = true;
    error.value = null;
    setSuccess(null);
    try {
      const bridge = createMindooDBAppBridge();
      const nextSession = await bridge.connect();
      stopThemeSync?.();
      stopViewportSync?.();
      session.value = nextSession;
      launchContext.value = await nextSession.getLaunchContext();
      eventLog.value = [];
      applyHostTheme(launchContext.value.theme, "launch-theme");
      setViewport(launchContext.value.viewport, "launch-viewport");
      stopThemeSync = nextSession.onThemeChange((theme) => {
        applyHostTheme(theme, "theme-changed");
      });
      stopViewportSync = nextSession.onViewportChange((viewport) => {
        setViewport(viewport, "viewport-changed");
      });
      databases.value = launchContext.value.databases;
      selectedViewId.value = launchContext.value.views[0]?.id ?? null;
      if (databases.value[0]) {
        await selectDatabase(databases.value[0].id);
      } else {
        startCreateDocument();
      }
      if (selectedViewId.value) {
        await loadSelectedView();
      }
    } catch (connectError) {
      applyAppTheme(null);
      hostViewport.value = null;
      error.value = readErrorMessage(
        connectError,
        "Failed to connect to MindooDB Haven. Launch the app from Haven or provide a compatible bridge host.",
      );
    } finally {
      loading.value = false;
    }
  }

  async function disconnect() {
    stopThemeSync?.();
    stopThemeSync = null;
    stopViewportSync?.();
    stopViewportSync = null;
    const currentSession = session.value;
    const currentView = currentViewHandle.value;
    session.value = null;
    currentViewHandle.value = null;
    if (currentView) {
      try {
        await currentView.dispose();
      } catch {
        // Ignore dispose errors during teardown.
      }
    }
    if (!currentSession) {
      return;
    }

    try {
      await currentSession.disconnect();
    } catch {
      // Ignore disconnect errors during teardown.
    }
  }

  async function selectDatabase(databaseId: string) {
    if (!session.value) {
      return;
    }
    loading.value = true;
    error.value = null;
    setSuccess(null);
    try {
      selectedDatabaseId.value = databaseId;
      selectedDatabase.value = await session.value.openDatabase(databaseId);
      await refreshDocuments();
      if (selectedView.value) {
        const usesSelectedDb = selectedView.value.sources.some((source) => source.databaseId === databaseId);
        if (usesSelectedDb) {
          await loadSelectedView();
        }
      }
    } catch (databaseError) {
      error.value = readErrorMessage(databaseError, "Failed to load the selected database.");
    } finally {
      loading.value = false;
    }
  }

  async function saveDocument() {
    if (!selectedDatabase.value) {
      return;
    }

    let data: Record<string, unknown>;
    try {
      const parsed = JSON.parse(editorJson.value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Document JSON must be an object.");
      }
      data = parsed as Record<string, unknown>;
    } catch (parseError) {
      error.value = readErrorMessage(parseError, "The JSON document could not be parsed.");
      return;
    }

    busyAction.value = editorMode.value === "create" ? "Creating document" : "Updating document";
    error.value = null;
    try {
      if (editorMode.value === "create") {
        if (!canCreate.value) {
          throw new Error("The selected database does not allow document creation.");
        }
        const created = await selectedDatabase.value.documents.create({
          data,
          decryptionKeyId: launchContext.value?.launchParameters.decryptionKeyId?.trim() || "default",
        });
        await refreshDocuments(created.id);
        setSuccess(`Created document ${created.id}.`);
      } else {
        if (!selectedDocumentId.value) {
          throw new Error("Select a document before updating it.");
        }
        if (!canUpdate.value) {
          throw new Error("The selected database does not allow document updates.");
        }
        const updated = await selectedDatabase.value.documents.update(selectedDocumentId.value, { data });
        await refreshDocuments(updated.id);
        setSuccess(`Updated document ${updated.id}.`);
      }
      if (selectedView.value) {
        await loadSelectedView();
      }
    } catch (saveError) {
      error.value = readErrorMessage(saveError, "The document could not be saved.");
    } finally {
      busyAction.value = null;
    }
  }

  async function deleteDocument() {
    if (!selectedDatabase.value || !selectedDocumentId.value) {
      return;
    }
    busyAction.value = "Deleting document";
    error.value = null;
    try {
      if (!canDelete.value) {
        throw new Error("The selected database does not allow document deletion.");
      }
      const docId = selectedDocumentId.value;
      await selectedDatabase.value.documents.delete(docId);
      await refreshDocuments();
      setSuccess(`Deleted document ${docId}.`);
      if (selectedView.value) {
        await loadSelectedView();
      }
    } catch (deleteError) {
      error.value = readErrorMessage(deleteError, "The document could not be deleted.");
    } finally {
      busyAction.value = null;
    }
  }

  async function downloadAttachment(attachmentName: string) {
    if (!selectedDatabase.value || !selectedDocumentId.value) {
      return;
    }

    busyAction.value = "Downloading attachment";
    error.value = null;
    try {
      const blob = await readAttachmentBlob(selectedDatabase.value, selectedDocumentId.value, attachmentName);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = attachmentName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      error.value = readErrorMessage(downloadError, "The attachment could not be downloaded.");
    } finally {
      busyAction.value = null;
    }
  }

  async function removeAttachment(attachmentName: string) {
    if (!selectedDatabase.value || !selectedDocumentId.value) {
      return;
    }

    busyAction.value = "Removing attachment";
    error.value = null;
    try {
      await selectedDatabase.value.attachments.remove(selectedDocumentId.value, attachmentName);
      await refreshAttachments();
      setSuccess(`Removed attachment ${attachmentName}.`);
    } catch (removeError) {
      error.value = readErrorMessage(removeError, "The attachment could not be removed.");
    } finally {
      busyAction.value = null;
    }
  }

  async function previewAttachment(attachmentName: string) {
    if (!selectedDatabase.value || !selectedDocumentId.value) {
      return;
    }

    busyAction.value = "Opening attachment preview";
    error.value = null;
    try {
      await selectedDatabase.value.attachments.openPreview(selectedDocumentId.value, attachmentName);
    } catch (previewError) {
      error.value = readErrorMessage(previewError, "The attachment preview could not be opened.");
    } finally {
      busyAction.value = null;
    }
  }

  async function uploadAttachments(fileList: FileList | null) {
    if (!selectedDatabase.value || !selectedDocumentId.value || !fileList?.length) {
      return;
    }

    busyAction.value = "Uploading attachment";
    error.value = null;
    try {
      for (const file of Array.from(fileList)) {
        const stream = await selectedDatabase.value.attachments.openWriteStream(
          selectedDocumentId.value,
          file.name,
          file.type || "application/octet-stream",
        );
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const chunkSize = 64 * 1024;
          for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            await stream.write(bytes.slice(offset, offset + chunkSize));
          }
          await stream.close();
        } catch (streamError) {
          await stream.abort();
          throw streamError;
        }
      }
      await refreshAttachments();
      await refreshDocuments(selectedDocumentId.value);
      setSuccess(`Uploaded ${fileList.length} attachment${fileList.length === 1 ? "" : "s"}.`);
    } catch (uploadError) {
      error.value = readErrorMessage(uploadError, "The attachment upload failed.");
    } finally {
      busyAction.value = null;
    }
  }

  async function refreshViewPage() {
    if (!currentViewHandle.value) {
      viewRows.value = [];
      viewExpansionState.value = null;
      return;
    }
    const page = await currentViewHandle.value.page({ pageSize: 250 });
    viewRows.value = page.rows;
    viewExpansionState.value = await currentViewHandle.value.getExpansionState();
  }

  async function loadSelectedView() {
    viewRows.value = [];
    viewMessage.value = null;

    const view = selectedView.value;
    if (!view) {
      return;
    }
    const sourceSession = session.value;
    if (!sourceSession) {
      return;
    }

    try {
      busyAction.value = "Loading view";
      await currentViewHandle.value?.dispose();
      currentViewHandle.value = await sourceSession.openView(view.id);
      await refreshViewPage();
      if (view.sources.length > 1) {
        viewMessage.value = "Multi-source Haven views depend on the current host implementation.";
      }
    } catch (viewError) {
      viewMessage.value = readErrorMessage(viewError, "The selected view could not be loaded.");
    } finally {
      busyAction.value = null;
    }
  }

  function setSelectedView(viewId: string | null) {
    selectedViewId.value = viewId;
    void loadSelectedView();
  }

  async function toggleCategory(row: MindooDBAppViewRow) {
    if (row.type !== "category" || !currentViewHandle.value) {
      return;
    }
    viewExpansionState.value = row.expanded
      ? await currentViewHandle.value.collapse(row.key)
      : await currentViewHandle.value.expand(row.key);
    await refreshViewPage();
  }

  async function expandAllViewCategories() {
    if (!currentViewHandle.value) {
      return;
    }
    viewExpansionState.value = await currentViewHandle.value.expandAll();
    await refreshViewPage();
  }

  async function collapseAllViewCategories() {
    if (!currentViewHandle.value) {
      return;
    }
    viewExpansionState.value = await currentViewHandle.value.collapseAll();
    await refreshViewPage();
  }

  onBeforeUnmount(() => {
    void disconnect();
  });

  return {
    loading,
    isBusy,
    busyAction,
    error,
    successMessage,
    hostTheme,
    hostViewport,
    launchContext,
    eventLog,
    databases,
    selectedDatabaseId,
    selectedDatabaseInfo,
    documents,
    selectedDocumentId,
    selectedDocument,
    editorJson,
    editorMode,
    historyEntries,
    selectedHistoricalDocument,
    historyMessage,
    attachments,
    attachmentMessage,
    availableViews,
    selectedViewId,
    selectedView,
    visibleViewColumns,
    viewRows,
    viewMessage,
    viewExpansionState,
    canCreate,
    canUpdate,
    canDelete,
    canBrowseHistory,
    canUseAttachments,
    canRead,
    canPreviewAttachment,
    connect,
    selectDatabase,
    startCreateDocument,
    selectDocument,
    saveDocument,
    deleteDocument,
    refreshDocuments,
    loadHistory,
    refreshAttachments,
    uploadAttachments,
    previewAttachment,
    downloadAttachment,
    removeAttachment,
    setSelectedView,
    loadSelectedView,
    toggleCategory,
    expandAllViewCategories,
    collapseAllViewCategories,
  };
}
