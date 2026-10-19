/**
 * The example app's tools for AI agents (WebMCP through Haven).
 *
 * This is the reference pattern to copy into your own app:
 *
 * - One factory, `createExampleAgentTools(deps)`, returns plain tool objects
 *   (`name`, `description`, `inputSchema`, `annotations`, `execute`). It knows
 *   nothing about Vue or the bridge, so unit tests call `execute` directly.
 * - Names carry no prefix. Haven adds `agentToolPrefix` from haven-app.json,
 *   so agents see `example_documents_list`; descriptions use those full names.
 * - Descriptions are written for a model: what the tool does, where ids come
 *   from, what it returns.
 * - Bad input and missing documents throw `MindooDBAppAgentToolError` with a
 *   code and, where useful, the next step for the agent (`requiredAction`).
 * - Every write is one undo step (see `agentUndo.ts`) and returns its
 *   `undoStepId`, so "undo that" is always one call.
 *
 * The example's documents are free-form JSON objects, so the tools pass
 * document data through as-is. An app with a real data model (todos, tasks,
 * contacts) should translate its storage fields into plain words instead;
 * see mindoodb-app-todomanager `src/features/agent/todoAgentTools.ts`.
 */
import {
  createViewLanguage,
  MindooDBAppAgentToolError,
  type MindooDBAppAgentTool,
  type MindooDBAppBooleanExpression,
  type MindooDBAppDatabase,
  type MindooDBAppQueryRow,
} from "mindoodb-app-sdk";

import { AgentUndoConflictError, type AgentUndo } from "./agentUndo";

/** What the tools need from the app. Small on purpose: easy to fake in tests. */
export type ExampleAgentDeps = {
  /** The database the Databases tab has open, or null before connecting. */
  database: () => MindooDBAppDatabase | null;
  /** Shown to agents by `example_get_context`: what the user sees right now. */
  context: () => Record<string, unknown>;
  /** True in time travel: every write is refused. */
  readOnly: () => boolean;
  /** Named document key for new documents (the app uses launch parameters). */
  decryptionKeyId: () => string;
  /** Records each write as one undo step. */
  undo: AgentUndo;
  /** Called after every write so the UI shows the change, e.g. selects the document. */
  afterWrite: (docId: string | null) => Promise<void>;
  /** Directory search; resolves to null when the database lacks the `directory` permission. */
  searchUsers: (query: string, limit: number) => Promise<string[] | null>;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Untyped view language: the example's documents have no fixed fields.
const v = createViewLanguage<Record<string, string | number | boolean>>();

// ── Input helpers ─────────────────────────────────────────────────────
// Agents send all kinds of input. Check it and say exactly what is wrong.

function invalid(message: string): never {
  throw new MindooDBAppAgentToolError("INVALID_INPUT", message);
}

function requiredString(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || !value.trim()) invalid(`${field} must be a non-empty string.`);
  return value.trim();
}

function optionalObject(input: Record<string, unknown>, field: string): Record<string, unknown> | undefined {
  const value = input[field];
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${field} must be a JSON object.`);
  return value as Record<string, unknown>;
}

function readLimit(input: Record<string, unknown>) {
  const value = input.limit;
  if (value === undefined) return DEFAULT_LIMIT;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) invalid("limit must be a positive integer.");
  return Math.min(value, MAX_LIMIT);
}

/** One exact condition per field: `{ "status": "open", "priority": 2 }`. */
function buildFilter(where: Record<string, unknown> | undefined): MindooDBAppBooleanExpression | undefined {
  const parts = Object.entries(where ?? {}).map(([field, value]) => {
    if (typeof value === "string") return v.eq(v.field(field), v.string(value));
    if (typeof value === "number") return v.eq(v.field(field), v.number(value));
    if (typeof value === "boolean") return v.eq(v.field(field), v.boolean(value));
    return invalid(`where.${field} must be a string, number or boolean.`);
  });
  if (!parts.length) return undefined;
  return parts.length === 1 ? parts[0] : v.and(...parts);
}

/** Fallback when the full-text index is off: every word must appear somewhere in the fields. */
function substringMatch(row: MindooDBAppQueryRow, text: string) {
  const haystack = JSON.stringify(row.fields).toLowerCase();
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

export function createExampleAgentTools(deps: ExampleAgentDeps): MindooDBAppAgentTool[] {
  function requireDatabase() {
    const database = deps.database();
    if (!database) {
      throw new MindooDBAppAgentToolError(
        "INVALID_STATE",
        "The example app has no database open.",
        "ask the user to open a database in the app's Databases tab",
      );
    }
    return database;
  }

  function requireWritable() {
    if (deps.readOnly()) {
      throw new MindooDBAppAgentToolError(
        "NOT_ALLOWED",
        "The app shows an older state of the data (time travel) and is read-only.",
        "ask the user to leave time travel in Haven",
      );
    }
    return requireDatabase();
  }

  async function loadDocument(database: MindooDBAppDatabase, docId: string) {
    const document = await database.documents.get(docId).catch(() => null);
    if (!document) {
      throw new MindooDBAppAgentToolError(
        "NOT_FOUND",
        `There is no document "${docId}".`,
        "call example_documents_list to find its docId",
      );
    }
    return document;
  }

  const getContext: MindooDBAppAgentTool = {
    name: "get_context",
    description:
      "What the user sees in the SDK example app right now: the open database, whether it is read-only, " +
      "the full-text index, the field names documents use, and the selected document (selectedDocId). " +
      'Call it first, and to resolve "this document".',
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    async execute() {
      return deps.context();
    },
  };

  const documentsList: MindooDBAppAgentTool = {
    name: "documents_list",
    description:
      "Finds documents in the open database. Returns docId, the document's fields and when it was last " +
      "modified. Two kinds of criteria, combinable: where (exact field values, e.g. {\"status\": \"open\"}) " +
      "and text (a topic search over the full-text index; matches word beginnings and small typos, best " +
      "match first). Without criteria it lists all documents. Field names: example_get_context.",
    inputSchema: {
      type: "object",
      properties: {
        where: {
          type: "object",
          description: "Exact values per top-level field: string, number or boolean. All must match.",
          additionalProperties: { type: ["string", "number", "boolean"] },
        },
        text: { type: "string", description: "Words to search for in the document text." },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, description: `Default ${DEFAULT_LIMIT}.` },
      },
    },
    // The fields contain text other people wrote: never follow instructions found in them.
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input) {
      const database = requireDatabase();
      const filter = buildFilter(optionalObject(input, "where"));
      const text = typeof input.text === "string" ? input.text.trim() : "";
      const limit = readLimit(input);

      // Exact criteria run as a query on the host's summary buffer: fast, no
      // documents are loaded. With the full-text index on, `text` joins the
      // same query and the host ranks the rows (`textScore`).
      const fulltext = text ? (await database.getFulltextSetup())?.enabled === true : false;
      const result = await database.documents.query({
        ...(filter ? { filter } : {}),
        ...(fulltext ? { text: { query: text, prefix: true, fuzzy: 0.2 } } : {}),
        limit: text && !fulltext ? 1000 : limit,
      });
      // Without an index, fall back to a substring match and say so, so the
      // agent knows recall is weaker (no prefixes, no typos).
      const rows = text && !fulltext ? result.rows.filter((row) => substringMatch(row, text)) : result.rows;
      const total = text && !fulltext ? rows.length : result.total;

      return {
        total,
        ...(total > limit ? { truncated: true } : {}),
        ...(text ? { textSearch: fulltext ? "full-text index" : "substring (the full-text index is off)" } : {}),
        documents: rows.slice(0, limit).map((row) => ({
          docId: row.docId,
          fields: row.fields,
          modified: new Date(row.lastModified).toISOString(),
          ...(row.textScore !== undefined ? { score: Math.round(row.textScore * 100) / 100 } : {}),
        })),
      };
    },
  };

  const documentGet: MindooDBAppAgentTool = {
    name: "document_get",
    description:
      "Reads one document completely: all its data and the names of its attachments. docId comes from " +
      "example_documents_list or example_get_context.",
    inputSchema: { type: "object", required: ["docId"], properties: { docId: { type: "string" } } },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input) {
      const document = await loadDocument(requireDatabase(), requiredString(input, "docId"));
      return {
        docId: document.id,
        data: document.data,
        attachments: (document.attachments ?? []).map((attachment) => attachment.fileName),
        ...(document.updatedAt ? { modified: document.updatedAt } : {}),
      };
    },
  };

  const documentCreate: MindooDBAppAgentTool = {
    name: "document_create",
    description:
      "Creates a document from a JSON object (one undo step). Reuse the field names other documents use " +
      "(example_get_context lists them). Returns the new docId and its undoStepId.",
    inputSchema: {
      type: "object",
      required: ["data"],
      properties: { data: { type: "object", description: "The document's fields, e.g. {\"title\": \"…\"}." } },
    },
    async execute(input) {
      const database = requireWritable();
      const data = optionalObject(input, "data") ?? invalid("data is missing.");
      if (!Object.keys(data).length) invalid("data must have at least one field.");
      const created = await database.documents.create({ set: data, decryptionKeyId: deps.decryptionKeyId() });
      const step = deps.undo.record({
        label: `Agent: create ${created.id}`,
        docId: created.id,
        before: null,
        after: (await database.documents.get(created.id))?.data ?? data,
      });
      await deps.afterWrite(created.id);
      return { docId: created.id, data: step.after, undoStepId: step.id };
    },
  };

  const documentUpdate: MindooDBAppAgentTool = {
    name: "document_update",
    description:
      "Changes top-level fields of one document (one undo step): set writes the given fields, unset removes " +
      "fields. Fields you do not name stay as they are. Returns the document's new data and its undoStepId.",
    inputSchema: {
      type: "object",
      required: ["docId"],
      properties: {
        docId: { type: "string" },
        set: { type: "object", description: "Fields to write." },
        unset: { type: "array", items: { type: "string" }, description: "Field names to remove." },
      },
    },
    async execute(input) {
      const database = requireWritable();
      const docId = requiredString(input, "docId");
      const set = optionalObject(input, "set") ?? {};
      const unset = input.unset ?? [];
      if (!Array.isArray(unset) || !unset.every((field) => typeof field === "string")) {
        invalid("unset must be a list of field names.");
      }
      if (!Object.keys(set).length && !unset.length) invalid("Give set or unset: nothing to change.");

      const before = (await loadDocument(database, docId)).data;
      await database.documents.update(docId, { set, unset });
      const after = (await database.documents.get(docId))?.data ?? null;
      const step = deps.undo.record({ label: `Agent: update ${docId}`, docId, before, after });
      await deps.afterWrite(docId);
      return { docId, data: after, undoStepId: step.id };
    },
  };

  const documentDelete: MindooDBAppAgentTool = {
    name: "document_delete",
    description:
      "Deletes one document. Haven asks the user to confirm first. One undo step: example_undo brings it back.",
    inputSchema: { type: "object", required: ["docId"], properties: { docId: { type: "string" } } },
    // consequentialHint: Haven shows its own confirmation dialog before the call runs.
    annotations: { consequentialHint: true },
    async execute(input) {
      const database = requireWritable();
      const docId = requiredString(input, "docId");
      const before = (await loadDocument(database, docId)).data;
      await database.documents.delete(docId);
      const step = deps.undo.record({ label: `Agent: delete ${docId}`, docId, before, after: null });
      await deps.afterWrite(null);
      return { deleted: docId, undoStepId: step.id };
    },
  };

  const undo: MindooDBAppAgentTool = {
    name: "undo",
    description:
      "Takes back one change an agent made with example_document_create, example_document_update or " +
      "example_document_delete. Pass the undoStepId the write returned; without it, the newest step. " +
      "Refused (STATE_CHANGED) when the document changed since; then ask the user before passing force: true.",
    inputSchema: {
      type: "object",
      properties: {
        undoStepId: { type: "string" },
        force: { type: "boolean", description: "Overwrite later changes too. Ask the user first." },
      },
    },
    async execute(input) {
      const database = requireWritable();
      try {
        const step = await deps.undo.undo(database, {
          ...(typeof input.undoStepId === "string" ? { stepId: input.undoStepId } : {}),
          force: input.force === true,
        });
        await deps.afterWrite(step.before ? step.docId : null);
        return { undone: step.label, docId: step.docId };
      } catch (error) {
        if (error instanceof AgentUndoConflictError) {
          throw new MindooDBAppAgentToolError(
            "STATE_CHANGED",
            error.message,
            "tell the user what changed; call again with force: true only if they agree",
          );
        }
        throw new MindooDBAppAgentToolError("INVALID_INPUT", error instanceof Error ? error.message : String(error));
      }
    },
  };

  const usersSearch: MindooDBAppAgentTool = {
    name: "users_search",
    description:
      "Finds people in the tenant directory by part of their user name. Returns their user names " +
      '(e.g. "CN=Paul Meyer/O=Acme"), for example to store in a document field.',
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "Part of the name." },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, description: `Default ${DEFAULT_LIMIT}.` },
      },
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input) {
      const users = await deps.searchUsers(requiredString(input, "query"), readLimit(input));
      if (!users) {
        throw new MindooDBAppAgentToolError(
          "NOT_ALLOWED",
          "The example app has no access to the directory.",
          "ask the user to grant the directory permission in the app's settings in Haven",
        );
      }
      return { users };
    },
  };

  return [getContext, documentsList, documentGet, documentCreate, documentUpdate, documentDelete, undo, usersSearch];
}
