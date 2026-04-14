/**
 * Views-tab composable for the MindooDB example application.
 *
 * Owns the full view navigator lifecycle: opening a Haven-configured view,
 * stateful cursor traversal (first / last / next / prev / parent / child),
 * category expansion / collapse, and batched entry reading via
 * `entriesForward`.
 *
 * ## Injected dependencies
 *
 * - `session` -- the connected SDK session (needed by `openViewNavigator`).
 * - `launchContext` -- provides the list of available view definitions.
 * - `busyAction` -- shared busy-gate ref written during long-running view
 *   operations so the global `isBusy` computed reflects view activity.
 *
 * ## Cross-tab wiring
 *
 * The root orchestrator calls `loadSelectedView()` after document mutations
 * (save / delete) so the view grid stays in sync.  `disposeNavigator()` is
 * called during disconnect.
 *
 * @module useViewsSection
 */
import { computed, type Ref } from "vue";
import {
  type MindooDBAppLaunchContext,
  type MindooDBAppSession,
  type MindooDBAppViewEntry,
  type MindooDBAppViewNavigator,
  type MindooDBAppViewNavigatorExpansionState,
} from "mindoodb-app-sdk";

import { getVisibleViewColumns } from "@/features/views/lib/runtimeViews";
import { ref } from "vue";

/** Extract the `.message` from an Error, or return the provided fallback string. */
function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export interface UseViewsSectionDeps {
  session: Ref<MindooDBAppSession | null>;
  launchContext: Ref<MindooDBAppLaunchContext | null>;
  busyAction: Ref<string | null>;
}

export function useViewsSection(deps: UseViewsSectionDeps) {
  const { session, launchContext, busyAction } = deps;

  // ── View navigator state ───────────────────────────────────────────
  const selectedViewId = ref<string | null>(null);
  /** The current page of serialised view entries shown in the UI. */
  const viewRows = ref<MindooDBAppViewEntry[]>([]);
  /** Snapshot of the navigator's expansion state (expand-all default + toggled keys). */
  const viewExpansionState = ref<MindooDBAppViewNavigatorExpansionState | null>(null);
  /** The entry the host-side navigator cursor is currently pointing at. */
  const currentViewEntry = ref<MindooDBAppViewEntry | null>(null);
  /** Whether the last `entriesForward` call indicated more entries beyond the batch limit. */
  const viewHasMore = ref(false);
  const viewMessage = ref<string | null>(null);
  /** The live navigator handle; `null` until a view has been opened. */
  const currentViewNavigator = ref<MindooDBAppViewNavigator | null>(null);

  // ── Derived / computed state ───────────────────────────────────────

  /** All Haven-configured view definitions from the launch context. */
  const availableViews = computed(() => launchContext.value?.views ?? []);
  const selectedView = computed(() =>
    availableViews.value.find((view) => view.id === selectedViewId.value) ?? null,
  );
  /** Non-hidden columns of the selected view, used for grid headers and value rendering. */
  const visibleViewColumns = computed(() =>
    selectedView.value ? getVisibleViewColumns(selectedView.value) : [],
  );
  /** `true` when at least one column in the selected view has the `"category"` role. */
  const viewHasCategories = computed(() =>
    selectedView.value?.columns.some((column) => column.role === "category") ?? false,
  );

  // ── View page refresh ──────────────────────────────────────────────

  /**
   * Re-read a batch of entries from the current navigator position and
   * synchronise all view-related reactive state (rows, expansion, cursor).
   *
   * Called after every navigation or expansion change so the UI stays in
   * sync with the host-side navigator.
   */
  async function refreshViewPage() {
    if (!currentViewNavigator.value) {
      viewRows.value = [];
      viewExpansionState.value = null;
      currentViewEntry.value = null;
      viewHasMore.value = false;
      return;
    }
    const page = await currentViewNavigator.value.entriesForward({ limit: 250 });
    viewRows.value = page.entries;
    viewExpansionState.value = await currentViewNavigator.value.getExpansionState();
    currentViewEntry.value = await currentViewNavigator.value.getCurrentEntry();
    viewHasMore.value = page.hasMore;
  }

  // ── Navigation helpers ─────────────────────────────────────────────

  /**
   * Generic wrapper for a single navigator cursor movement.
   *
   * Sets `busyAction` for the duration of the move, executes the provided
   * `step` callback (which calls one `goto*` method on the navigator), then
   * refreshes the view page so the UI reflects the new cursor position.
   */
  async function navigateView(
    label: string,
    step: (navigator: MindooDBAppViewNavigator) => Promise<boolean>,
  ) {
    if (!currentViewNavigator.value) {
      return;
    }
    try {
      busyAction.value = label;
      await step(currentViewNavigator.value);
      await refreshViewPage();
    } finally {
      busyAction.value = null;
    }
  }

  /** Move the navigator cursor to an arbitrary entry by its position string (e.g. on row click). */
  async function focusViewEntry(entry: MindooDBAppViewEntry) {
    if (!currentViewNavigator.value || !entry.position) {
      return;
    }
    try {
      busyAction.value = "Focusing view entry";
      await currentViewNavigator.value.gotoPos(entry.position);
      await refreshViewPage();
    } finally {
      busyAction.value = null;
    }
  }

  // ── Single-step navigation helpers ───────────────────────────────────
  // Each wraps `navigateView` with the corresponding navigator method.

  async function gotoFirstViewEntry() {
    await navigateView("Navigating view", (navigator) => navigator.gotoFirst());
  }

  async function gotoLastViewEntry() {
    await navigateView("Navigating view", (navigator) => navigator.gotoLast());
  }

  async function gotoNextViewEntry() {
    await navigateView("Navigating view", (navigator) => navigator.gotoNext());
  }

  async function gotoPreviousViewEntry() {
    await navigateView("Navigating view", (navigator) => navigator.gotoPrev());
  }

  async function gotoParentViewEntry() {
    await navigateView("Navigating view", (navigator) => navigator.gotoParent());
  }

  async function gotoFirstChildViewEntry() {
    await navigateView("Navigating view", (navigator) => navigator.gotoFirstChild());
  }

  /** Convenience: focus the first category row currently visible in the batch. */
  async function focusFirstVisibleViewCategory() {
    const category = viewRows.value.find((entry) => entry.kind === "category");
    if (!category) {
      return;
    }
    await focusViewEntry(category);
  }

  // ── View loading ───────────────────────────────────────────────────

  /**
   * Open the currently selected Haven-configured view via the SDK bridge,
   * dispose any previously open navigator, and load the first batch of results.
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
      await currentViewNavigator.value?.dispose();
      currentViewNavigator.value = await sourceSession.openViewNavigator(view.id);
      await currentViewNavigator.value.gotoFirst();
      await refreshViewPage();
      if (view.sources.length > 1) {
        viewMessage.value = "This navigator is reading a multi-source Haven view.";
      }
    } catch (viewError) {
      viewMessage.value = readErrorMessage(viewError, "The selected view could not be loaded.");
    } finally {
      busyAction.value = null;
    }
  }

  /** Change the active view selection and immediately load it (fire-and-forget). */
  function setSelectedView(viewId: string | null) {
    selectedViewId.value = viewId;
    void loadSelectedView();
  }

  // ── Category expansion helpers ──────────────────────────────────────

  /** Toggle the expanded / collapsed state of a category row. */
  async function toggleCategory(row: MindooDBAppViewEntry) {
    if (row.kind !== "category" || !row.docId || !currentViewNavigator.value) {
      return;
    }
    if (row.expanded) {
      await currentViewNavigator.value.collapse(row.origin, row.docId);
    } else {
      await currentViewNavigator.value.expand(row.origin, row.docId);
    }
    viewExpansionState.value = await currentViewNavigator.value.getExpansionState();
    await refreshViewPage();
  }

  /** Expand the category entry the navigator cursor is currently pointing at. */
  async function expandCurrentViewEntry() {
    const entry = currentViewEntry.value;
    if (!entry || entry.kind !== "category" || !entry.docId || !currentViewNavigator.value) {
      return;
    }
    await currentViewNavigator.value.expand(entry.origin, entry.docId);
    viewExpansionState.value = await currentViewNavigator.value.getExpansionState();
    await refreshViewPage();
  }

  /** Collapse the category entry the navigator cursor is currently pointing at. */
  async function collapseCurrentViewEntry() {
    const entry = currentViewEntry.value;
    if (!entry || entry.kind !== "category" || !entry.docId || !currentViewNavigator.value) {
      return;
    }
    await currentViewNavigator.value.collapse(entry.origin, entry.docId);
    viewExpansionState.value = await currentViewNavigator.value.getExpansionState();
    await refreshViewPage();
  }

  /** Expand every category in the view at once. */
  async function expandAllViewCategories() {
    if (!currentViewNavigator.value) {
      return;
    }
    await currentViewNavigator.value.expandAll();
    viewExpansionState.value = await currentViewNavigator.value.getExpansionState();
    await refreshViewPage();
  }

  /** Collapse every category in the view at once. */
  async function collapseAllViewCategories() {
    if (!currentViewNavigator.value) {
      return;
    }
    await currentViewNavigator.value.collapseAll();
    viewExpansionState.value = await currentViewNavigator.value.getExpansionState();
    await refreshViewPage();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  /** Dispose the host-side navigator during session teardown. */
  async function disposeNavigator() {
    const nav = currentViewNavigator.value;
    currentViewNavigator.value = null;
    if (nav) {
      try {
        await nav.dispose();
      } catch {
        // Ignore dispose errors during teardown.
      }
    }
  }

  return {
    selectedViewId,
    viewRows,
    viewExpansionState,
    currentViewEntry,
    viewHasMore,
    viewMessage,
    availableViews,
    selectedView,
    visibleViewColumns,
    viewHasCategories,
    loadSelectedView,
    setSelectedView,
    focusViewEntry,
    focusFirstVisibleViewCategory,
    gotoFirstViewEntry,
    gotoLastViewEntry,
    gotoNextViewEntry,
    gotoPreviousViewEntry,
    gotoParentViewEntry,
    gotoFirstChildViewEntry,
    toggleCategory,
    expandCurrentViewEntry,
    collapseCurrentViewEntry,
    expandAllViewCategories,
    collapseAllViewCategories,
    disposeNavigator,
  };
}
