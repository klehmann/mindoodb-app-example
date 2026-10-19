/**
 * Undo for the writes AI agents make through the example's agent tools.
 *
 * Every write tool records exactly one step: the document's data before and
 * after the call (`null` = the document did not exist / was deleted). Undo
 * writes the "before" state back. Before it does, it checks that the document
 * still looks like the agent left it — if the user (or a sync) changed it in
 * between, undo refuses instead of silently overwriting that change.
 *
 * The history lives for this app session only. A full editor-style undo/redo
 * that also covers the user's own edits is in mindoodb-app-todomanager
 * (`src/features/undo/todoUndo.ts`).
 */
import type { MindooDBAppDatabase } from "mindoodb-app-sdk";
import { ref } from "vue";

export type AgentUndoStep = {
  /** Returned to the agent as `undoStepId`. */
  id: string;
  /** Plain-language label, e.g. `Agent: update "Quarterly report"`. */
  label: string;
  /** ISO timestamp. */
  at: string;
  docId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  undone: boolean;
};

/** Undo refused: the document no longer matches the state the step left behind. */
export class AgentUndoConflictError extends Error {}

const MAX_STEPS = 50;

/** JSON with sorted keys, so two equal objects compare equal regardless of key order. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function sameData(left: Record<string, unknown> | null, right: Record<string, unknown> | null) {
  return stableJson(left) === stableJson(right);
}

export function createAgentUndo() {
  const steps = ref<AgentUndoStep[]>([]);
  let counter = 0;

  function record(input: Omit<AgentUndoStep, "id" | "at" | "undone">): AgentUndoStep {
    counter += 1;
    const step: AgentUndoStep = {
      ...input,
      id: `u${Date.now().toString(36)}${counter}`,
      at: new Date().toISOString(),
      undone: false,
    };
    steps.value = [...steps.value, step].slice(-MAX_STEPS);
    return step;
  }

  /**
   * Undoes `stepId`, or the newest step that is not undone yet. With `force`
   * the conflict check is skipped (the agent should ask the user first).
   */
  async function undo(database: MindooDBAppDatabase, input: { stepId?: string; force?: boolean } = {}) {
    const open = steps.value.filter((step) => !step.undone);
    const step = input.stepId ? open.find((entry) => entry.id === input.stepId) : open.at(-1);
    if (!step) {
      throw new Error(input.stepId ? `There is no undoable step "${input.stepId}".` : "There is nothing to undo.");
    }

    const current = (await database.documents.get(step.docId))?.data ?? null;
    if (!input.force && !sameData(current, step.after)) {
      throw new AgentUndoConflictError(`Document ${step.docId} changed after "${step.label}".`);
    }

    if (step.before === null) {
      // The step created the document: undo deletes it again.
      await database.documents.delete(step.docId);
    } else {
      if (current === null) {
        // The step deleted the document: bring it back with the same id.
        await database.documents.undelete(step.docId);
      }
      const now = (await database.documents.get(step.docId))?.data ?? {};
      const unset = Object.keys(now).filter((key) => !(key in step.before!));
      await database.documents.update(step.docId, { set: step.before, unset });
    }
    steps.value = steps.value.map((entry) => (entry.id === step.id ? { ...entry, undone: true } : entry));
    return step;
  }

  return { steps, record, undo };
}

export type AgentUndo = ReturnType<typeof createAgentUndo>;
