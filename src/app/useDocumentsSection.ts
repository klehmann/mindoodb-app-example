/**
 * Documents-tab composable for the MindooDB example application.
 *
 * Owns all state and actions related to the Databases tab:
 *
 * - **Document browsing** -- listing summaries (paged), selecting a document,
 *   switching between all / existing / deleted, and local ID filtering.
 * - **Document CRUD** -- create, update (JSON editor), and soft-delete.
 * - **Revision history** -- listing history entries and restoring snapshots.
 * - **Attachments** -- list, upload (chunked write stream), download (read
 *   stream to Blob), preview (Haven viewer or pop-out), and remove.
 * - **Full-text search** -- MindooDB's built-in full-text index: enable it
 *   through `db.setFulltextSetup()` and query it with the `text` clause of
 *   `documents.query()` (host-maintained, no client index to build or sync).
 *
 * ## Injected dependencies
 *
 * - `selectedDatabase` -- the currently opened `MindooDBAppDatabase` handle.
 * - `launchContext` -- provides `launchParameters.decryptionKeyId` for
 *   document creation and `runtime` for attachment preview routing.
 * - Capability computeds (`canCreate`, `canRead`, ...) -- gate CRUD and
 *   attachment actions.
 * - Shared UI refs (`error`, `busyAction`) and `setSuccess` -- global error
 *   and busy-state management owned by the root.
 * - `onDocumentMutation` -- callback invoked after save / delete so the root
 *   can refresh views.
 *
 * @module useDocumentsSection
 */
import { computed, ref, type ComputedRef, type Ref } from "vue";
import {
  canPreviewAttachment,
  type MindooDBAppAttachmentInfo,
  type MindooDBAppDatabase,
  type MindooDBAppDocument,
  type MindooDBAppDocumentSummary,
  type MindooDBAppDocumentHistoryEntry,
  type MindooDBAppHistoricalDocument,
  type MindooDBAppLaunchContext,
} from "mindoodb-app-sdk";

import { t, tn } from "@/i18n";

/** Filter applied to the document list API: show all, only live, or only soft-deleted documents. */
type DocumentListMode = "all" | "existing" | "deleted";

/** Pretty-print any value as indented JSON, defaulting to `{}` for nullish input. */
function stringifyJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function buildTopLevelDocumentPatch(
  current: Record<string, unknown>,
  next: Record<string, unknown>,
) {
  const set: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if (!Object.is(current[key], value)) {
      set[key] = value;
    }
  }
  const unset = Object.keys(current).filter((key) => !(key in next));
  return { set, unset };
}

/** Extract the `.message` from an Error, or return the provided fallback string. */
function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Reads an attachment via the SDK's pull-based stream and assembles it into
 * a single Blob suitable for browser download or preview.
 */
async function readAttachmentBlob(
  database: MindooDBAppDatabase,
  docId: string,
  attachmentName: string,
) {
  const stream = await database.attachments.openReadStream(
    docId,
    attachmentName,
  );
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

export interface UseDocumentsSectionDeps {
  selectedDatabase: Ref<MindooDBAppDatabase | null>;
  launchContext: Ref<MindooDBAppLaunchContext | null>;
  canCreate: ComputedRef<boolean>;
  canRead: ComputedRef<boolean>;
  canUpdate: ComputedRef<boolean>;
  canDelete: ComputedRef<boolean>;
  canBrowseHistory: ComputedRef<boolean>;
  canUseAttachments: ComputedRef<boolean>;
  error: Ref<string | null>;
  busyAction: Ref<string | null>;
  setSuccess: (message: string | null) => void;
  onDocumentMutation: () => Promise<void>;
}

export function useDocumentsSection(deps: UseDocumentsSectionDeps) {
  const {
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
    onDocumentMutation,
  } = deps;

  // ── Document browsing & editing state ──────────────────────────────
  // The browsable list stores lightweight summaries; the full document
  // body is loaded lazily when a row is selected.
  const documentListEntries = ref<MindooDBAppDocumentSummary[]>([]);
  const selectedDocumentId = ref<string | null>(null);
  const selectedDocument = ref<MindooDBAppDocument | null>(null);
  const editorJson = ref("{\n}");
  const editorMode = ref<"create" | "edit">("create");
  const historyEntries = ref<MindooDBAppDocumentHistoryEntry[]>([]);
  const selectedHistoricalDocument = ref<MindooDBAppHistoricalDocument | null>(
    null,
  );
  const historyMessage = ref<string | null>(null);
  const attachments = ref<MindooDBAppAttachmentInfo[]>([]);
  const attachmentMessage = ref<string | null>(null);
  const documentIdFilter = ref("");
  const documentListMode = ref<DocumentListMode>("existing");

  // ── Full-text search state (host-side MindooDB full-text index) ────
  const availableSearchFields = ref<string[]>([]);
  const searchFieldSelection = ref<string[]>([]);
  const indexedFields = ref<string[]>([]);
  const fulltextEnabled = ref(false);
  const searchQuery = ref("");
  const searchResults = ref<string[]>([]);
  let searchRunToken = 0;
  let searchDebounceHandle: ReturnType<typeof setTimeout> | null = null;

  // ── Derived / computed state ───────────────────────────────────────

  const selectedDocumentSummary = computed(
    () =>
      documentListEntries.value.find(
        (document) => document.id === selectedDocumentId.value,
      ) ?? null,
  );
  const hasSearchIndex = computed(() => fulltextEnabled.value);

  /**
   * Filtered document list shown in the Databases tab.
   *
   * Applies two local-only filters on top of the already-fetched summary
   * list: an ID substring match and, when a search query is active, an
   * intersection with the docIds matched by the host's full-text query.
   */
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

  // ── Internal helpers ───────────────────────────────────────────────

  /** Clear all secondary database panels (detail, history, attachments) when switching documents. */
  function resetDatabasePanels() {
    selectedDocument.value = null;
    historyEntries.value = [];
    selectedHistoricalDocument.value = null;
    historyMessage.value = null;
    attachments.value = [];
    attachmentMessage.value = null;
  }

  /** Switch the editor into "create" mode with an empty JSON template. */
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
    availableSearchFields.value = Array.from(keys).sort((left, right) =>
      left.localeCompare(right),
    );
    if (!searchFieldSelection.value.length) {
      searchFieldSelection.value = [...availableSearchFields.value];
    } else {
      searchFieldSelection.value = searchFieldSelection.value.filter((field) =>
        keys.has(field),
      );
    }
  }

  /** Reset all derived search state when switching databases. */
  function resetSearchIndexState() {
    searchRunToken += 1;
    if (searchDebounceHandle !== null) {
      clearTimeout(searchDebounceHandle);
      searchDebounceHandle = null;
    }
    searchFieldSelection.value = [];
    availableSearchFields.value = [];
    indexedFields.value = [];
    fulltextEnabled.value = false;
    searchQuery.value = "";
    searchResults.value = [];
  }

  /**
   * Read the database's full-text configuration (from the synced `dbsetup`
   * document) and mirror it into the reactive search UI state.
   */
  async function refreshSearchSetup() {
    fulltextEnabled.value = false;
    indexedFields.value = [];
    if (!selectedDatabase.value || !canRead.value) {
      return;
    }
    try {
      const setup = await selectedDatabase.value.getFulltextSetup();
      fulltextEnabled.value = setup?.enabled === true;
      indexedFields.value = setup?.include ? [...setup.include] : [];
      if (indexedFields.value.length && !searchFieldSelection.value.length) {
        searchFieldSelection.value = [...indexedFields.value];
      }
    } catch (setupError) {
      console.error("Reading the full-text setup failed", setupError);
    }
  }

  /**
   * Run the active search query against the host's full-text index and
   * store the matching docIds. Stale responses (from a superseded query
   * or database switch) are dropped via the run token.
   */
  async function runSearchQuery() {
    const query = searchQuery.value.trim();
    const token = ++searchRunToken;
    if (!query || !selectedDatabase.value || !fulltextEnabled.value) {
      searchResults.value = [];
      return;
    }
    try {
      const result = await selectedDatabase.value.documents.query({
        text: { query },
        limit: 1000,
      });
      if (token !== searchRunToken) {
        return;
      }
      searchResults.value = result.rows.map((row) => row.docId);
    } catch (searchError) {
      if (token !== searchRunToken) {
        return;
      }
      console.error("Full-text query failed", searchError);
      searchResults.value = [];
      error.value = readErrorMessage(searchError, t("searchFailed"));
    }
  }

  // ── Document selection & CRUD ──────────────────────────────────────

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
      historyMessage.value = t("docDeletedHistory");
      attachmentMessage.value = t("docDeletedAttachments");
      return;
    }
    selectedDocument.value =
      (await selectedDatabase.value?.documents.get(docId)) ?? null;
    editorJson.value = stringifyJson(selectedDocument.value?.data ?? {});
    await refreshAttachments();
  }

  /** Refresh the browsable document list, then keep the current selection stable if possible. */
  async function refreshDocuments(preferredDocId?: string | null) {
    if (!selectedDatabase.value || !canRead.value) {
      documentListEntries.value = [];
      startCreateDocument();
      return;
    }

    documentListEntries.value = await listAllDocumentEntries(
      documentListMode.value,
    );
    await refreshAvailableSearchFields();
    if (searchQuery.value.trim()) {
      await runSearchQuery();
    }

    const nextDocId =
      preferredDocId &&
      documentListEntries.value.some((item) => item.id === preferredDocId)
        ? preferredDocId
        : (documents.value[0]?.id ?? documentListEntries.value[0]?.id ?? null);
    if (nextDocId) {
      await selectDocument(nextDocId);
    } else {
      startCreateDocument();
    }
  }

  /** Re-fetch the attachment list for the currently selected document. */
  async function refreshAttachments() {
    attachments.value = [];
    attachmentMessage.value = null;
    if (
      !selectedDatabase.value ||
      !selectedDocumentId.value ||
      !selectedDocument.value ||
      !canUpdate.value
    ) {
      return;
    }
    if (!canUseAttachments.value) {
      attachmentMessage.value = t("attachmentsNotAllowed");
      return;
    }

    attachments.value = await selectedDatabase.value.attachments.list(
      selectedDocumentId.value,
    );
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
      historyMessage.value = t("historyNotAllowed");
      return;
    }

    historyEntries.value = await selectedDatabase.value.documents.listHistory(
      selectedDocumentId.value,
    );
    if (!historyEntries.value.length) {
      historyMessage.value = t("historyEmpty");
      return;
    }

    const nextTimestamp = timestamp ?? historyEntries.value[0]?.timestamp;
    if (nextTimestamp == null) {
      return;
    }
    selectedHistoricalDocument.value =
      await selectedDatabase.value.documents.getAtTimestamp(
        selectedDocumentId.value,
        nextTimestamp,
      );
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
        throw new Error(t("jsonNotObject"));
      }
      data = parsed as Record<string, unknown>;
    } catch (parseError) {
      error.value = readErrorMessage(parseError, t("jsonParseFailed"));
      return;
    }

    busyAction.value =
      editorMode.value === "create" ? t("busyCreating") : t("busyUpdating");
    error.value = null;
    try {
      if (editorMode.value === "create") {
        if (!canCreate.value) {
          throw new Error(t("createNotAllowed"));
        }
        const created = await selectedDatabase.value.documents.create({
          set: data,
          decryptionKeyId:
            launchContext.value?.launchParameters.decryptionKeyId?.trim() ||
            "default",
        });
        await refreshDocuments(created.id);
        setSuccess(t("createdDocument", { id: created.id }));
      } else {
        if (!selectedDocumentId.value) {
          throw new Error(t("selectBeforeUpdate"));
        }
        if (!canUpdate.value) {
          throw new Error(t("updateNotAllowed"));
        }
        if (!selectedDocument.value) {
          throw new Error(t("documentUnavailable"));
        }
        const patch = buildTopLevelDocumentPatch(
          selectedDocument.value.data,
          data,
        );
        const updated = await selectedDatabase.value.documents.update(
          selectedDocumentId.value,
          patch,
        );
        await refreshDocuments(updated.id);
        setSuccess(t("updatedDocument", { id: updated.id }));
      }
      await onDocumentMutation();
    } catch (saveError) {
      error.value = readErrorMessage(saveError, t("saveFailed"));
    } finally {
      busyAction.value = null;
    }
  }

  /** Soft-delete the currently selected document and refresh the list and any active view. */
  async function deleteDocument() {
    if (
      !selectedDatabase.value ||
      !selectedDocumentId.value ||
      !selectedDocument.value
    ) {
      return;
    }
    busyAction.value = t("busyDeleting");
    error.value = null;
    try {
      if (!canDelete.value) {
        throw new Error(t("deleteNotAllowed"));
      }
      const docId = selectedDocumentId.value;
      await selectedDatabase.value.documents.delete(docId);
      await refreshDocuments();
      setSuccess(t("deletedDocument", { id: docId }));
      await onDocumentMutation();
    } catch (deleteError) {
      error.value = readErrorMessage(deleteError, t("deleteFailed"));
    } finally {
      busyAction.value = null;
    }
  }

  // ── Attachment actions ─────────────────────────────────────────────

  /** Stream an attachment into a Blob, then trigger a browser download via a temporary object URL. */
  async function downloadAttachment(attachmentName: string) {
    if (
      !selectedDatabase.value ||
      !selectedDocumentId.value ||
      !selectedDocument.value
    ) {
      return;
    }

    busyAction.value = t("busyDownloading");
    error.value = null;
    try {
      const blob = await readAttachmentBlob(
        selectedDatabase.value,
        selectedDocumentId.value,
        attachmentName,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = attachmentName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      error.value = readErrorMessage(downloadError, t("downloadFailed"));
    } finally {
      busyAction.value = null;
    }
  }

  /** Remove a named attachment from the selected document and refresh the attachment list. */
  async function removeAttachment(attachmentName: string) {
    if (
      !selectedDatabase.value ||
      !selectedDocumentId.value ||
      !selectedDocument.value
    ) {
      return;
    }

    busyAction.value = t("busyRemovingAttachment");
    error.value = null;
    try {
      await selectedDatabase.value.attachments.remove(
        selectedDocumentId.value,
        attachmentName,
      );
      await refreshAttachments();
      setSuccess(t("removedAttachment", { name: attachmentName }));
    } catch (removeError) {
      error.value = readErrorMessage(removeError, t("removeAttachmentFailed"));
    } finally {
      busyAction.value = null;
    }
  }

  /** Open Haven's built-in attachment viewer for the given file. */
  async function previewAttachment(attachmentName: string) {
    if (!selectedDatabase.value || !selectedDocumentId.value) {
      return;
    }

    busyAction.value = t("busyPreview");
    error.value = null;
    try {
      await selectedDatabase.value.attachments.openPreview(
        selectedDocumentId.value,
        attachmentName,
      );
    } catch (previewError) {
      error.value = readErrorMessage(previewError, t("previewFailed"));
    } finally {
      busyAction.value = null;
    }
  }

  /**
   * Upload one or more files as document attachments using the SDK's
   * push-based write stream. Files are chunked at 64 KB boundaries to
   * keep bridge message sizes manageable.
   */
  async function uploadAttachments(
    fileList: FileList | readonly File[] | null,
  ) {
    const files = fileList ? Array.from(fileList) : [];
    console.log("[mindoodb-app-example.attachments] upload requested", {
      documentId: selectedDocumentId.value,
      fileCount: files.length,
      fileNames: files.map((file) => file.name),
    });
    if (
      !selectedDatabase.value ||
      !selectedDocumentId.value ||
      !selectedDocument.value ||
      !files.length
    ) {
      return;
    }

    busyAction.value = t("busyUploading");
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
      setSuccess(tn("uploadedAttachments", files.length));
    } catch (uploadError) {
      error.value = readErrorMessage(uploadError, t("uploadFailed"));
    } finally {
      busyAction.value = null;
    }
  }

  async function scanAttachment() {
    if (
      !selectedDatabase.value ||
      !selectedDocumentId.value ||
      !selectedDocument.value
    ) {
      return;
    }

    busyAction.value = t("busyScanning");
    error.value = null;
    try {
      const result = await selectedDatabase.value.attachments.scan(
        selectedDocumentId.value,
        {
          defaultFileName: `scan-${selectedDocumentId.value}.pdf`,
          preset: "a4-portrait",
          mimeType: "application/pdf",
        },
      );
      if (result.ok) {
        await refreshAttachments();
        await refreshDocuments(selectedDocumentId.value);
        setSuccess(t("scannedDocument"));
      }
    } catch (scanError) {
      error.value = readErrorMessage(scanError, t("scanFailed"));
    } finally {
      busyAction.value = null;
    }
  }

  // ── Full-text search actions ────────────────────────────────────────

  /**
   * Enable (or reconfigure) the database's built-in full-text index for the
   * selected fields. The configuration lands in the synced `dbsetup`
   * document; the host indexes in the background from then on — there is
   * nothing to sync manually.
   */
  async function enableSearchIndex(fields: string[]) {
    if (!selectedDatabase.value) {
      return;
    }
    busyAction.value = t("busyEnablingIndex");
    error.value = null;
    try {
      await selectedDatabase.value.setFulltextSetup({
        enabled: true,
        include: fields,
      });
      await refreshSearchSetup();
      await runSearchQuery();
      setSuccess(tn("indexEnabled", fields.length));
    } catch (indexError) {
      console.error("Enable full-text index failed", indexError);
      error.value = readErrorMessage(indexError, t("indexEnableFailed"));
    } finally {
      busyAction.value = null;
    }
  }

  /** Remove the full-text configuration; the host drops the index. */
  async function disableSearchIndex() {
    if (!selectedDatabase.value) {
      return;
    }
    busyAction.value = t("busyDisablingIndex");
    error.value = null;
    try {
      await selectedDatabase.value.setFulltextSetup(null);
      await refreshSearchSetup();
      searchResults.value = [];
      setSuccess(t("indexDisabled"));
    } catch (indexError) {
      console.error("Disable full-text index failed", indexError);
      error.value = readErrorMessage(indexError, t("indexDisableFailed"));
    } finally {
      busyAction.value = null;
    }
  }

  /**
   * Update the search box value and (debounced) run the query against the
   * host's full-text index.
   */
  function setSearchQuery(query: string) {
    searchQuery.value = query;
    if (searchDebounceHandle !== null) {
      clearTimeout(searchDebounceHandle);
    }
    if (!query.trim()) {
      searchRunToken += 1;
      searchResults.value = [];
      return;
    }
    searchDebounceHandle = setTimeout(() => {
      searchDebounceHandle = null;
      void runSearchQuery();
    }, 200);
  }

  /** The All / Existing / Deleted toggle simply re-runs the summary list query with a different status filter. */
  async function setDocumentListMode(mode: DocumentListMode) {
    documentListMode.value = mode;
    await refreshDocuments(selectedDocumentId.value);
  }

  return {
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
    canSaveCurrentDocument,
    canPreviewAttachment,
    startCreateDocument,
    selectDocument,
    refreshDocuments,
    resetSearchIndexState,
    refreshSearchSetup,
    enableSearchIndex,
    disableSearchIndex,
    setSearchQuery,
    setDocumentListMode,
    saveDocument,
    deleteDocument,
    loadHistory,
    refreshAttachments,
    uploadAttachments,
    scanAttachment,
    previewAttachment,
    downloadAttachment,
    removeAttachment,
  };
}
