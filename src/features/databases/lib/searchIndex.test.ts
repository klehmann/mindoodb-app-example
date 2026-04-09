import { describe, expect, it } from "vitest";
import type { MindooDBAppDatabase, MindooDBAppDocument } from "mindoodb-app-sdk";

import { createDocumentSearchIndex } from "@/features/databases/lib/searchIndex";

function createMockDatabase(documents: MindooDBAppDocument[]): MindooDBAppDatabase {
  const storedDocuments = new Map(documents.map((document) => [document.id, document]));
  const changeItems = [
    { id: "doc-1", isDeleted: false },
    { id: "doc-2", isDeleted: false },
    { id: "doc-3", isDeleted: true },
  ];

  return {
    documents: {
      async list(query) {
        if (query?.cursor === "cursor-3") {
          return {
            items: [],
            nextCursor: null,
          };
        }

        return {
          items: changeItems,
          nextCursor: "cursor-3",
        };
      },
      async get(docId) {
        return storedDocuments.get(docId) ?? null;
      },
    },
  } as MindooDBAppDatabase;
}

describe("searchIndex", () => {
  it("indexes selected document fields and returns matching ids", async () => {
    const db = createMockDatabase([
      {
        id: "doc-1",
        data: {
          firstname: "Karsten",
          lastname: "Lehmann",
        },
      },
      {
        id: "doc-2",
        data: {
          firstname: "Tammo",
          lastname: "Riedinger",
        },
      },
    ]);

    const index = createDocumentSearchIndex();
    const stats = await index.createIndex(["firstname", "lastname"], db);

    expect(stats).toEqual({
      indexed: 2,
      deleted: 1,
      totalProcessed: 3,
    });
    expect(index.search("Lehmann")).toEqual(["doc-1"]);
    expect(index.search("Tammo")).toEqual(["doc-2"]);
  });

  it("indexes mixed JSON field types without crashing", async () => {
    const db = createMockDatabase([
      {
        id: "doc-1",
        data: {
          _attachments: [{
            fileName: "Bildschirmfoto 2014-03-07 um 14.50.45.png",
            mimeType: "image/png",
            size: 11341,
          }],
          _lastModified: 1775688017370,
          comment: "Edited in Haven",
          firstname: "Karsten",
          lastname: "Lehmann",
        },
      },
      {
        id: "doc-2",
        data: {
          _lastModified: 1775687911928,
          firstname: "Tammo",
          lastname: "Riedinger",
        },
      },
    ]);

    const index = createDocumentSearchIndex();
    const stats = await index.createIndex(["_attachments", "_lastModified", "comment", "firstname", "lastname"], db);

    expect(stats).toEqual({
      indexed: 2,
      deleted: 1,
      totalProcessed: 3,
    });
    expect(index.search("Lehmann")).toEqual(["doc-1"]);
    expect(index.search("Edited")).toEqual(["doc-1"]);
    expect(index.search("Bildschirmfoto")).toEqual(["doc-1"]);
    expect(index.search("1775687911928")).toEqual(["doc-2"]);
  });

  it("keeps the last checkpoint so a no-op sync stays incremental", async () => {
    const db = createMockDatabase([
      {
        id: "doc-1",
        data: {
          firstname: "Karsten",
          lastname: "Lehmann",
        },
      },
      {
        id: "doc-2",
        data: {
          firstname: "Tammo",
          lastname: "Riedinger",
        },
      },
    ]);

    const index = createDocumentSearchIndex();

    await index.createIndex(["firstname", "lastname"], db);
    const stats = await index.syncIndex(db);

    expect(stats).toEqual({
      updated: 0,
      deleted: 0,
      totalProcessed: 0,
    });
  });
});
