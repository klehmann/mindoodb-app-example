import { computed, onBeforeUnmount, ref } from "vue";
import {
  canPreviewAttachment,
  createMindooDBAppBridge,
  type MindooDBAppAttachmentInfo,
  type MindooDBAppDatabase,
  type MindooDBAppDatabaseInfo,
  type MindooDBAppDocument,
  type MindooDBAppDocumentSummary,
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
import {
  createDocumentSearchIndex,
  type SearchIndexCreateStats,
  type SearchIndexSyncStats,
} from "@/features/databases/lib/searchIndex";
import { getVisibleViewColumns } from "@/features/views/lib/runtimeViews";

type DocumentListMode = "all" | "existing" | "deleted";
type SearchIndexStats = SearchIndexCreateStats | SearchIndexSyncStats;

/**
 * One entry in the Events tab log, recording theme and viewport changes
 * from both the initial launch snapshot and subsequent live updates.
 */
export type DemoEventEntry = {
  id: string;
  kind: "launch-theme" | "launch-viewport" | "theme-changed" | "viewport-changed";
  createdAt: string;
  label: string;
  payload: string;
};

/** Prepend an event entry to the log, capping at 40 entries to bound memory. */
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

/**
 * Reads an attachment via the SDK's pull-based stream and assembles it into
 * a single Blob suitable for browser download or preview.
 */
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

/**
 * Central Vue composable that drives the entire example application.
 *
 * It owns the full SDK lifecycle -- bridge connection, session management,
 * theme/viewport event subscriptions, and teardown -- and exposes reactive
 * state plus action functions consumed by the three UI tabs:
 *
 * - **Databases tab:** database selection, document CRUD, history browsing,
 *   and attachment management (upload, download, preview, remove).
 * - **Views tab:** opening Haven-configured virtual views, paginating rows,
 *   and expanding/collapsing categories.
 * - **Events tab:** theme and viewport event log populated from the initial
 *   launch snapshot and subsequent live updates.
 *
 * All SDK calls flow through this composable so the UI components remain
 * thin presentational wrappers. Capability checks (`canCreate`, `canDelete`,
 * etc.) are derived from the active database's permission set so the UI can
 * gate actions declaratively.
 */
export function useMindooDBDemoApp() {
  const searchIndex = createDocumentSearchIndex();
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

  // Keep the browsable list as lightweight summaries; the full document is loaded lazily on selection.
  const documentListEntries = ref<MindooDBAppDocumentSummary[]>([]);
  const selectedDocumentId = ref<string | null>(null);
  const selectedDocument = ref<MindooDBAppDocument | null>(null);
  const editorJson = ref("{\n}");
  const editorMode = ref<"create" | "edit">("create");
  const historyEntries = ref<MindooDBAppDocumentHistoryEntry[]>([]);
  const selectedHistoricalDocument = ref<MindooDBAppHistoricalDocument | null>(null);
  const historyMessage = ref<string | null>(null);
  const attachments = ref<MindooDBAppAttachmentInfo[]>([]);
  const attachmentMessage = ref<string | null>(null);
  const busyAction = ref<string | null>(null);
  const documentIdFilter = ref("");
  const documentListMode = ref<DocumentListMode>("existing");
  const availableSearchFields = ref<string[]>([]);
  const searchFieldSelection = ref<string[]>([]);
  const indexedFields = ref<string[]>([]);
  const searchQuery = ref("");
  const searchResults = ref<string[]>([]);
  const indexCursor = ref<string | null>(null);
  const indexStats = ref<SearchIndexStats | null>(null);

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
  const selectedDocumentSummary = computed(() =>
    documentListEntries.value.find((document) => document.id === selectedDocumentId.value) ?? null,
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
  const hasSearchIndex = computed(() => indexedFields.value.length > 0);
  // The UI filters the already-fetched summary list locally by ID and optional full-text hits.
  const documents = computed(() => {
    const idFilter = documentIdFilter.value.trim().toLowerCase();
    const activeSearchResults = searchQuery.value.trim()
      ? new Set(searchResults.value)
      : null;
    return documentListEntries.value.filter((document) => {
      if (idFilter && !document.id.toLowerCase().includes(idFilter)) {
        return false;
      }
      if (activeSearchResults && !activeSearchResults.has(document.id)) {
        return false;
      }
      return true;
    });
  });
  const canSaveCurrentDocument = computed(() =>
    editorMode.value === "create"
      ? canCreate.value
      : canUpdate.value && Boolean(selectedDocument.value),
  );

  function setSuccess(message: string | null) {
    successMessage.value = message;
    if (message) {
      error.value = null;
    }
  }

  /** Apply a theme from Haven to the PrimeVue runtime and record it in the event log. */
  function applyHostTheme(theme?: MindooDBAppHostTheme | null, kind: DemoEventEntry["kind"] = "theme-changed") {
    hostTheme.value = applyAppTheme(theme);
    addEventEntry(eventLog.value, {
      kind,
      label: kind === "launch-theme" ? "Initial theme" : "Theme changed",
      payload: stringifyJson(theme ?? hostTheme.value),
    });
  }

  /** Store the current iframe viewport and record the event in the log. */
  function setViewport(viewport: MindooDBAppViewport | null, kind: DemoEventEntry["kind"] = "viewport-changed") {
    hostViewport.value = viewport;
    addEventEntry(eventLog.value, {
      kind,
      label: kind === "launch-viewport" ? "Initial viewport" : "Viewport changed",
      payload: stringifyJson(viewport),
    });
  }

  function resetDatabasePanels() {
    selectedDocument.value = null;
    historyEntries.value = [];
    selectedHistoricalDocument.value = null;
    historyMessage.value = null;
    attachments.value = [];
    attachmentMessage.value = null;
  }

  function startCreateDocument() {
    editorMode.value = "create";
    selectedDocumentId.value = null;
    selectedDocument.value = null;
    editorJson.value = "{\n}";
    resetDatabasePanels();
    setSuccess(null);
  }

  /** Walk the paged SDK list API until the current browse mode is fully loaded. */
  async function listAllDocumentEntries(mode: DocumentListMode) {
    if (!selectedDatabase.value) {
      return [];
    }
    const items: MindooDBAppDocumentSummary[] = [];
    let cursor: string | null = null;

    while (true) {
      const page = await selectedDatabase.value.documents.list({
        cursor,
        limit: 250,
        status: mode,
      });
      items.push(...page.items);
      if (!page.nextCursor || page.nextCursor === cursor) {
        break;
      }
      cursor = page.nextCursor;
    }

    return items;
  }

  /** Infer candidate search fields from the currently visible non-deleted summaries. */
  async function refreshAvailableSearchFields() {
    availableSearchFields.value = [];
    if (!documentListEntries.value.length) {
      return;
    }
    const keys = new Set<string>();
    const sampleEntries = documentListEntries.value
      .filter((entry) => !entry.isDeleted && entry.data)
      .slice(0, 25);
    for (const entry of sampleEntries) {
      Object.keys(entry.data ?? {}).forEach((key) => keys.add(key));
    }
    availableSearchFields.value = Array.from(keys).sort((left, right) => left.localeCompare(right));
    if (!searchFieldSelection.value.length) {
      searchFieldSelection.value = [...availableSearchFields.value];
    } else {
      searchFieldSelection.value = searchFieldSelection.value.filter((field) => keys.has(field));
    }
  }

  /** Mirror the search helper's internal checkpoint and schema back into reactive UI state. */
  function syncIndexState() {
    const state = searchIndex.getState();
    indexedFields.value = state.indexedFields;
    indexCursor.value = state.cursor;
  }

  /** Reset all derived search state when switching databases or rebuilding from scratch. */
  function resetSearchIndexState() {
    searchIndex.clear();
    searchFieldSelection.value = [];
    availableSearchFields.value = [];
    indexedFields.value = [];
    searchQuery.value = "";
    searchResults.value = [];
    indexCursor.value = null;
    indexStats.value = null;
  }

  /**
   * Switch the editor to the chosen document.
   *
   * Deleted documents keep their summary row in the list, but the editor falls
   * back to a read-only placeholder and pushes the user toward the history UI.
   */
  async function selectDocument(docId: string | null) {
    selectedDocumentId.value = docId;
    resetDatabasePanels();
    const summary = selectedDocumentSummary.value;
    if (!docId || !summary) {
      startCreateDocument();
      return;
    }
    editorMode.value = "edit";
    if (summary.isDeleted) {
      editorJson.value = "{\n}";
      historyMessage.value = "The selected document is deleted. Use the history browser to inspect earlier revisions.";
      attachmentMessage.value = "Deleted documents do not expose current attachments.";
      return;
    }
    selectedDocument.value = await selectedDatabase.value?.documents.get(docId) ?? null;
    editorJson.value = stringifyJson(selectedDocument.value?.data ?? {});
    await refreshAttachments();
  }

  /** Refresh the browsable document list, then keep the current selection stable if possible. */
  async function refreshDocuments(preferredDocId?: string | null) {
    if (!selectedDatabase.value || !selectedDatabaseId.value || !canRead.value) {
      documentListEntries.value = [];
      startCreateDocument();
      return;
    }

    documentListEntries.value = await listAllDocumentEntries(documentListMode.value);
    await refreshAvailableSearchFields();
    if (searchQuery.value.trim()) {
      searchResults.value = searchIndex.search(searchQuery.value);
    }

    const nextDocId = preferredDocId && documentListEntries.value.some((item) => item.id === preferredDocId)
      ? preferredDocId
      : documents.value[0]?.id ?? documentListEntries.value[0]?.id ?? null;
    if (nextDocId) {
      await selectDocument(nextDocId);
    } else {
      startCreateDocument();
    }
  }

  async function refreshAttachments() {
    attachments.value = [];
    attachmentMessage.value = null;
    if (!selectedDatabase.value || !selectedDocumentId.value || !selectedDocument.value) {
      return;
    }
    if (!canUseAttachments.value) {
      attachmentMessage.value = "Attachment access is not allowed for the selected database.";
      return;
    }

    attachments.value = await selectedDatabase.value.attachments.list(selectedDocumentId.value);
  }

  /**
   * Load the revision history for the selected document and, optionally,
   * restore a historical snapshot at a specific timestamp.
   */
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

  /**
   * Establish the SDK bridge session with Haven.
   *
   * Creates the bridge, connects, reads the launch context, subscribes to
   * theme/viewport events, discovers mapped databases and views, and loads
   * initial data for the first database and view.
   */
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

  /** Tear down event subscriptions, dispose the active view handle, and disconnect the session. */
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

  /** Switch to a different mapped database, reload its documents, and refresh related views. */
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
      resetSearchIndexState();
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

  /**
   * Create or update a document from the JSON editor content.
   *
   * When creating, the decryption key id is taken from `launchParameters`
   * (falling back to `"default"`) so the demo shows how apps can use
   * named document keys.
   */
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
        if (!selectedDocument.value) {
          throw new Error("The selected document is deleted or unavailable.");
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
    if (!selectedDatabase.value || !selectedDocumentId.value || !selectedDocument.value) {
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
    if (!selectedDatabase.value || !selectedDocumentId.value || !selectedDocument.value) {
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
    if (!selectedDatabase.value || !selectedDocumentId.value || !selectedDocument.value) {
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

  /** Open Haven's built-in attachment viewer for the given file. */
  async function previewAttachment(attachmentName: string) {
    if (!selectedDatabase.value || !selectedDocumentId.value) {
      return;
    }

    busyAction.value = "Opening attachment preview";
    error.value = null;
    try {
      if (launchContext.value?.runtime === "window" && typeof window !== "undefined") {
        console.log("[attachment-preview]", "Opening window-mode preview.", {
          documentId: selectedDocumentId.value,
          attachmentName,
        });
        const previewTab = window.open("", "_blank");
        if (!previewTab) {
          throw new Error("The preview tab could not be opened. Allow popups and try again.");
        }
        previewTab.document.title = "Opening attachment preview...";
        console.log("[attachment-preview]", "Blank preview tab opened.");

        try {
          console.log("[attachment-preview]", "Requesting prepared preview session from Haven.");
          const previewSession = await selectedDatabase.value.attachments.preparePreviewSession(
            selectedDocumentId.value,
            attachmentName,
          );
          console.log("[attachment-preview]", "Prepared preview session received.", previewSession);
          previewTab.location.href = previewSession.previewUrl;
          console.log("[attachment-preview]", "Preview tab navigated.", {
            previewUrl: previewSession.previewUrl,
          });
        } catch (previewError) {
          console.error("[attachment-preview]", "Preparing preview session failed.", previewError);
          previewTab.close();
          throw previewError;
        }
        return;
      }
      await selectedDatabase.value.attachments.openPreview(selectedDocumentId.value, attachmentName);
    } catch (previewError) {
      error.value = readErrorMessage(previewError, "The attachment preview could not be opened.");
    } finally {
      busyAction.value = null;
    }
  }

  /**
   * Upload one or more files as document attachments using the SDK's
   * push-based write stream. Files are chunked at 64 KB boundaries to
   * keep bridge message sizes manageable.
   */
  async function uploadAttachments(fileList: FileList | readonly File[] | null) {
    const files = fileList ? Array.from(fileList) : [];
    console.log("[mindoodb-app-example.attachments] upload requested", {
      documentId: selectedDocumentId.value,
      fileCount: files.length,
      fileNames: files.map((file) => file.name),
    });
    if (!selectedDatabase.value || !selectedDocumentId.value || !selectedDocument.value || !files.length) {
      return;
    }

    busyAction.value = "Uploading attachment";
    error.value = null;
    try {
      for (const file of files) {
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
      setSuccess(`Uploaded ${files.length} attachment${files.length === 1 ? "" : "s"}.`);
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

  /**
   * Open the currently selected Haven-configured view via the SDK bridge,
   * dispose any previously open handle, and load the first page of results.
   */
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

  async function createSearchIndex(fields: string[]) {
    if (!selectedDatabase.value) {
      return;
    }
    busyAction.value = "Creating full-text index";
    error.value = null;
    try {
      indexStats.value = await searchIndex.createIndex(fields, selectedDatabase.value);
      syncIndexState();
      searchResults.value = searchQuery.value.trim() ? searchIndex.search(searchQuery.value) : [];
      setSuccess(`Created fulltext index: ${indexStats.value.indexed} documents indexed.`);
    } catch (indexError) {
      console.error("Create full-text index failed", indexError);
      error.value = readErrorMessage(indexError, "The full-text index could not be created.");
    } finally {
      busyAction.value = null;
    }
  }

  /** Replay only changes since the last stored checkpoint into the in-memory FlexSearch index. */
  async function syncSearchIndex() {
    if (!selectedDatabase.value) {
      return;
    }
    busyAction.value = "Syncing full-text index";
    error.value = null;
    try {
      indexStats.value = await searchIndex.syncIndex(selectedDatabase.value);
      syncIndexState();
      searchResults.value = searchQuery.value.trim() ? searchIndex.search(searchQuery.value) : [];
      setSuccess(`Updated fulltext index with ${indexStats.value.updated} changes and ${indexStats.value.deleted} deletions.`);
      await refreshDocuments(selectedDocumentId.value);
    } catch (indexError) {
      console.error("Sync full-text index failed", indexError);
      error.value = readErrorMessage(indexError, "The full-text index could not be synced.");
    } finally {
      busyAction.value = null;
    }
  }

  /** Search runs entirely against the local FlexSearch index, not against Haven. */
  function setSearchQuery(query: string) {
    searchQuery.value = query;
    searchResults.value = query.trim() ? searchIndex.search(query) : [];
  }

  /** The All / Existing / Deleted toggle simply re-runs the summary list query with a different status filter. */
  async function setDocumentListMode(mode: DocumentListMode) {
    documentListMode.value = mode;
    await refreshDocuments(selectedDocumentId.value);
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
    documentIdFilter,
    documentListMode,
    documents,
    selectedDocumentSummary,
    selectedDocumentId,
    selectedDocument,
    editorJson,
    editorMode,
    historyEntries,
    selectedHistoricalDocument,
    historyMessage,
    attachments,
    attachmentMessage,
    availableSearchFields,
    searchFieldSelection,
    indexedFields,
    hasSearchIndex,
    searchQuery,
    searchResults,
    indexCursor,
    indexStats,
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
    canSaveCurrentDocument,
    canPreviewAttachment,
    connect,
    selectDatabase,
    startCreateDocument,
    selectDocument,
    createSearchIndex,
    syncSearchIndex,
    setSearchQuery,
    setDocumentListMode,
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
