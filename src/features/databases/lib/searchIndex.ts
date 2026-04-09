import { Document } from "flexsearch";
import type { MindooDBAppDatabase, MindooDBAppDocument } from "mindoodb-app-sdk";

const PAGE_SIZE = 500;

type IndexedDocument = {
  id: string;
  data: Record<string, unknown>;
};

export interface SearchIndexCreateStats {
  indexed: number;
  deleted: number;
  totalProcessed: number;
}

export interface SearchIndexSyncStats {
  updated: number;
  deleted: number;
  totalProcessed: number;
}

export interface SearchIndexStateSnapshot {
  cursor: string | null;
  indexedFields: string[];
  hasIndex: boolean;
}

function toFlexFieldPath(field: string) {
  return ["data", ...field.split(".").map((part) => part.trim()).filter(Boolean)].join(":");
}

function createFlexDocument(fields: string[]) {
  return new Document<IndexedDocument>({
    tokenize: "forward",
    fastupdate: true,
    document: {
      id: "id",
      index: fields.map(toFlexFieldPath),
    },
  });
}

function normalizeFields(fields: string[]) {
  return Array.from(new Set(fields.map((field) => field.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function flattenValueForIndex(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => flattenValueForIndex(entry)).filter(Boolean).join(" ");
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .flatMap(([key, entry]) => [key, flattenValueForIndex(entry)])
      .filter(Boolean)
      .join(" ");
  }
  return String(value);
}

function getFieldValueByPath(data: Record<string, unknown>, field: string) {
  return field
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<unknown>((current, part) => {
      if (!current || typeof current !== "object" || !(part in current)) {
        return undefined;
      }
      return (current as Record<string, unknown>)[part];
    }, data);
}

function setFieldValueByPath(target: Record<string, unknown>, field: string, value: string) {
  const parts = field.split(".").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) {
    return;
  }

  let current: Record<string, unknown> = target;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1] as string] = value;
}

function asIndexedDocument(document: MindooDBAppDocument, fields: string[]): IndexedDocument {
  const indexedData: Record<string, unknown> = {};
  for (const field of fields) {
    setFieldValueByPath(indexedData, field, flattenValueForIndex(getFieldValueByPath(document.data, field)));
  }

  return {
    id: document.id,
    data: indexedData,
  };
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function iterateAllChanges(
  db: MindooDBAppDatabase,
  cursor: string | null,
  onPage: (result: Awaited<ReturnType<MindooDBAppDatabase["documents"]["list"]>>) => Promise<void>,
) {
  let nextCursor = cursor;
  let checkpointCursor = cursor;

  while (true) {
    const result = await db.documents.list({
      cursor: nextCursor,
      limit: PAGE_SIZE,
      status: "all",
      metadataOnly: true,
    });
    await onPage(result);
    if (result.nextCursor && result.nextCursor !== nextCursor) {
      checkpointCursor = result.nextCursor;
    }
    if (!result.nextCursor || result.nextCursor === nextCursor) {
      return checkpointCursor;
    }
    nextCursor = result.nextCursor;
  }
}

export function createDocumentSearchIndex() {
  let index: Document<IndexedDocument> | null = null;
  let indexedFields: string[] = [];
  let cursor: string | null = null;

  return {
    getState(): SearchIndexStateSnapshot {
      return {
        cursor,
        indexedFields: [...indexedFields],
        hasIndex: index !== null,
      };
    },

    clear() {
      index = null;
      indexedFields = [];
      cursor = null;
    },

    async createIndex(fields: string[], db: MindooDBAppDatabase): Promise<SearchIndexCreateStats> {
      const normalizedFields = normalizeFields(fields);
      if (!normalizedFields.length) {
        throw new Error("Select at least one document field to build the full-text index.");
      }

      const nextIndex = createFlexDocument(normalizedFields);
      let nextCursor: string | null = null;

      const stats: SearchIndexCreateStats = {
        indexed: 0,
        deleted: 0,
        totalProcessed: 0,
      };

      nextCursor = await iterateAllChanges(db, null, async (result) => {
        for (const item of result.items) {
          stats.totalProcessed += 1;
          if (item.isDeleted) {
            stats.deleted += 1;
            continue;
          }
          const document = await db.documents.get(item.id);
          if (!document) {
            continue;
          }
          try {
            nextIndex.add(asIndexedDocument(document, normalizedFields));
          } catch (error) {
            console.error("Full-text index create failed", {
              docId: item.id,
              fields: normalizedFields,
              error,
            });
            throw new Error(`Failed to index document ${item.id}: ${toErrorMessage(error)}`);
          }
          stats.indexed += 1;
        }
      });

      index = nextIndex;
      indexedFields = normalizedFields;
      cursor = nextCursor;
      return stats;
    },

    async syncIndex(db: MindooDBAppDatabase): Promise<SearchIndexSyncStats> {
      if (!index || !indexedFields.length) {
        throw new Error("Create the full-text index before syncing it.");
      }

      const stats: SearchIndexSyncStats = {
        updated: 0,
        deleted: 0,
        totalProcessed: 0,
      };

      const nextCursor = await iterateAllChanges(db, cursor, async (result) => {
        for (const item of result.items) {
          stats.totalProcessed += 1;
          if (item.isDeleted) {
            index?.remove(item.id);
            stats.deleted += 1;
            continue;
          }
          const document = await db.documents.get(item.id);
          if (!document) {
            index?.remove(item.id);
            stats.deleted += 1;
            continue;
          }
          try {
            index?.update(asIndexedDocument(document, indexedFields));
          } catch (error) {
            console.error("Full-text index sync failed", {
              docId: item.id,
              fields: indexedFields,
              error,
            });
            throw new Error(`Failed to sync indexed document ${item.id}: ${toErrorMessage(error)}`);
          }
          stats.updated += 1;
        }
      });

      if (nextCursor) {
        cursor = nextCursor;
      }
      return stats;
    },

    search(query: string) {
      if (!index) {
        return [];
      }
      const trimmedQuery = query.trim();
      if (!trimmedQuery) {
        return [];
      }
      const results = index.search(trimmedQuery, { merge: true, limit: 1000 }) as Array<{ id: string | number }>;
      return results.map((entry) => String(entry.id));
    },
  };
}
