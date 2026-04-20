/**
 * Root orchestrator composable for the MindooDB example application.
 *
 * This file composes three tab-aligned sub-composables and wires the
 * cross-tab callbacks that keep them in sync:
 *
 * - {@link useDocumentsSection} -- document CRUD, history, attachments,
 *   and client-side full-text search.
 * - {@link useViewsSection} -- stateful view navigator traversal,
 *   category expansion / collapse, and batched entry reading.
 * - {@link useEventsSection} -- rolling log of host-pushed theme and
 *   viewport events.
 *
 * The root owns the SDK bridge lifecycle (`connect` / `disconnect`),
 * shared UI state (`error`, `busyAction`, `successMessage`), database
 * selection, and capability flags.  It merges the three sub-composable
 * surfaces into a single flat return object so all UI components can
 * consume `app.*` without knowing about the internal split.
 *
 * ## Lifecycle
 *
 * 1. The hosting Vue component calls `connect()` on mount.  This performs
 *    the `postMessage` handshake, reads the launch context, subscribes to
 *    host events, and loads the first database and view.
 * 2. All SDK calls are channelled through action functions exposed by this
 *    composable; the UI components remain thin presentational wrappers.
 * 3. `onBeforeUnmount` triggers `disconnect()`, which disposes the active
 *    navigator, tears down event subscriptions, and closes the session.
 *
 * ## Error / busy model
 *
 * A single `error` ref and a `busyAction` ref gate the entire UI.  Every
 * long-running action sets `busyAction` while in flight so the UI can
 * disable controls, and clears it in a `finally` block.  `isBusy` is a
 * computed that combines `busyAction` with the initial `loading` flag.
 *
 * @module useMindooDBDemoApp
 */
import { computed, onBeforeUnmount, ref } from "vue";
import {
  createMindooDBAppBridge,
  type MindooDBAppDatabase,
  type MindooDBAppDatabaseInfo,
  type MindooDBAppLaunchContext,
  type MindooDBAppSession,
} from "mindoodb-app-sdk";

import { useEventsSection } from "./useEventsSection";
import { useViewsSection } from "./useViewsSection";
import { useDocumentsSection } from "./useDocumentsSection";

export { type DemoEventEntry } from "./useEventsSection";

/** Extract the `.message` from an Error, or return the provided fallback string. */
function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Central Vue composable that drives the entire example application.
 *
 * Composes {@link useDocumentsSection}, {@link useViewsSection}, and
 * {@link useEventsSection} and wires the cross-tab callbacks so document
 * mutations refresh views and database changes reset search state.
 *
 * All SDK calls flow through this composable so the UI components remain
 * thin presentational wrappers.  Capability checks (`canCreate`, `canDelete`,
 * etc.) are derived from the active database's permission set so the UI can
 * gate actions declaratively.
 */
export function useMindooDBDemoApp() {
  // ── Session & global UI state ──────────────────────────────────────
  const session = ref<MindooDBAppSession | null>(null);
  const launchContext = ref<MindooDBAppLaunchContext | null>(null);
  const databases = ref<MindooDBAppDatabaseInfo[]>([]);
  const selectedDatabaseId = ref<string | null>(null);
  const selectedDatabase = ref<MindooDBAppDatabase | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const successMessage = ref<string | null>(null);
  const busyAction = ref<string | null>(null);

  // ── Derived / computed state ───────────────────────────────────────

  const selectedDatabaseInfo = computed(() =>
    databases.value.find((database) => database.id === selectedDatabaseId.value) ?? null,
  );

  // Capability flags derived from the active database's permission set,
  // used by the UI to declaratively gate CRUD and attachment actions.
  const canCreate = computed(() => selectedDatabaseInfo.value?.capabilities.includes("create") ?? false);
  const canUpdate = computed(() => selectedDatabaseInfo.value?.capabilities.includes("update") ?? false);
  const canDelete = computed(() => selectedDatabaseInfo.value?.capabilities.includes("delete") ?? false);
  const canBrowseHistory = computed(() => selectedDatabaseInfo.value?.capabilities.includes("history") ?? false);
  const canUseAttachments = computed(() => selectedDatabaseInfo.value?.capabilities.includes("attachments") ?? false);
  const canRead = computed(() => selectedDatabaseInfo.value?.capabilities.includes("read") ?? false);
  /** Global busy flag: `true` during initial load or any in-flight action. */
  const isBusy = computed(() => Boolean(busyAction.value) || loading.value);

  /** Set the success banner and clear any previous error. */
  function setSuccess(message: string | null) {
    successMessage.value = message;
    if (message) {
      error.value = null;
    }
  }

  // ── Sub-composables ────────────────────────────────────────────────

  const events = useEventsSection();

  const views = useViewsSection({
    session,
    launchContext,
    busyAction,
  });

  const documents = useDocumentsSection({
    selectedDatabase,
    launchContext,
    canCreate,
    canRead,
    canUpdate,
    canDelete,
    canBrowseHistory,
    canUseAttachments,
    error,
    busyAction,
    setSuccess,
    onDocumentMutation: async () => {
      if (views.selectedView.value) {
        await views.loadSelectedView();
      }
    },
  });

  // ── Session lifecycle ──────────────────────────────────────────────

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
      session.value = nextSession;
      launchContext.value = await nextSession.getLaunchContext();
      events.subscribeToHostEvents(nextSession, launchContext.value);
      databases.value = launchContext.value.databases;
      views.selectedViewId.value = launchContext.value.views[0]?.id ?? null;
      if (databases.value[0]) {
        await selectDatabase(databases.value[0].id);
      } else {
        documents.startCreateDocument();
      }
      if (views.selectedViewId.value) {
        await views.loadSelectedView();
      }
    } catch (connectError) {
      events.resetTheme();
      error.value = readErrorMessage(
        connectError,
        "Failed to connect to MindooDB Haven. Launch the app from Haven or provide a compatible bridge host.",
      );
    } finally {
      loading.value = false;
    }
  }

  /** Tear down event subscriptions, dispose the active navigator, and disconnect the session. */
  async function disconnect() {
    events.teardownSubscriptions();
    const currentSession = session.value;
    session.value = null;
    await views.disposeNavigator();
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
      documents.resetSearchIndexState();
      await documents.refreshDocuments();
      if (views.selectedView.value) {
        const usesSelectedDb = views.selectedView.value.sources.some((source) => source.databaseId === databaseId);
        if (usesSelectedDb) {
          await views.loadSelectedView();
        }
      }
    } catch (databaseError) {
      error.value = readErrorMessage(databaseError, "Failed to load the selected database.");
    } finally {
      loading.value = false;
    }
  }

  onBeforeUnmount(() => {
    void disconnect();
  });

  // ── Public surface ─────────────────────────────────────────────────
  // Merges session / global state, capability flags, and the three
  // sub-composable surfaces into one flat object so UI components can
  // bind to `app.*` without knowing about the split.
  return {
    // Session & global UI
    loading,
    isBusy,
    busyAction,
    error,
    successMessage,
    launchContext,
    databases,
    selectedDatabaseId,
    selectedDatabaseInfo,
    canCreate,
    canUpdate,
    canDelete,
    canBrowseHistory,
    canUseAttachments,
    canRead,

    // Session actions
    connect,
    selectDatabase,

    // Events section
    hostTheme: events.hostTheme,
    hostViewport: events.hostViewport,
    hostUiPreferences: events.hostUiPreferences,
    eventLog: events.eventLog,

    // Documents section
    documentIdFilter: documents.documentIdFilter,
    documentListMode: documents.documentListMode,
    documents: documents.documents,
    selectedDocumentSummary: documents.selectedDocumentSummary,
    selectedDocumentId: documents.selectedDocumentId,
    selectedDocument: documents.selectedDocument,
    editorJson: documents.editorJson,
    editorMode: documents.editorMode,
    historyEntries: documents.historyEntries,
    selectedHistoricalDocument: documents.selectedHistoricalDocument,
    historyMessage: documents.historyMessage,
    attachments: documents.attachments,
    attachmentMessage: documents.attachmentMessage,
    availableSearchFields: documents.availableSearchFields,
    searchFieldSelection: documents.searchFieldSelection,
    indexedFields: documents.indexedFields,
    hasSearchIndex: documents.hasSearchIndex,
    searchQuery: documents.searchQuery,
    searchResults: documents.searchResults,
    indexCursor: documents.indexCursor,
    indexStats: documents.indexStats,
    canSaveCurrentDocument: documents.canSaveCurrentDocument,
    canPreviewAttachment: documents.canPreviewAttachment,
    startCreateDocument: documents.startCreateDocument,
    selectDocument: documents.selectDocument,
    createSearchIndex: documents.createSearchIndex,
    syncSearchIndex: documents.syncSearchIndex,
    setSearchQuery: documents.setSearchQuery,
    setDocumentListMode: documents.setDocumentListMode,
    saveDocument: documents.saveDocument,
    deleteDocument: documents.deleteDocument,
    refreshDocuments: documents.refreshDocuments,
    loadHistory: documents.loadHistory,
    refreshAttachments: documents.refreshAttachments,
    uploadAttachments: documents.uploadAttachments,
    previewAttachment: documents.previewAttachment,
    downloadAttachment: documents.downloadAttachment,
    removeAttachment: documents.removeAttachment,

    // Views section
    availableViews: views.availableViews,
    selectedViewId: views.selectedViewId,
    selectedView: views.selectedView,
    visibleViewColumns: views.visibleViewColumns,
    viewHasCategories: views.viewHasCategories,
    viewRows: views.viewRows,
    viewMessage: views.viewMessage,
    viewExpansionState: views.viewExpansionState,
    currentViewEntry: views.currentViewEntry,
    viewHasMore: views.viewHasMore,
    setSelectedView: views.setSelectedView,
    loadSelectedView: views.loadSelectedView,
    focusViewEntry: views.focusViewEntry,
    focusFirstVisibleViewCategory: views.focusFirstVisibleViewCategory,
    gotoFirstViewEntry: views.gotoFirstViewEntry,
    gotoLastViewEntry: views.gotoLastViewEntry,
    gotoNextViewEntry: views.gotoNextViewEntry,
    gotoPreviousViewEntry: views.gotoPreviousViewEntry,
    gotoParentViewEntry: views.gotoParentViewEntry,
    gotoFirstChildViewEntry: views.gotoFirstChildViewEntry,
    toggleCategory: views.toggleCategory,
    expandCurrentViewEntry: views.expandCurrentViewEntry,
    collapseCurrentViewEntry: views.collapseCurrentViewEntry,
    expandAllViewCategories: views.expandAllViewCategories,
    collapseAllViewCategories: views.collapseAllViewCategories,
  };
}
