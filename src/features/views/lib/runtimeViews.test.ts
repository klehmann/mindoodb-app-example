import { describe, expect, it } from "vitest";
import type { MindooDBAppResolvedViewDefinition } from "mindoodb-app-sdk";

import { getVisibleViewColumns, toRuntimeViewDefinition } from "@/features/views/lib/runtimeViews";

describe("runtimeViews", () => {
  it("converts Haven-managed views into runtime view definitions", () => {
    const resolvedView: MindooDBAppResolvedViewDefinition = {
      id: "hoursByEmployee",
      description: "Hours by employee",
      categorizationStyle: "category_then_document",
      previewMode: "tree",
      sources: [{
        origin: "main",
        databaseId: "main",
        title: "Main database",
        targetMode: "local",
        tenantId: "tenant-1",
        databaseName: "time-records",
      }],
      filter: {
        mode: "rules",
        match: "all",
        rules: [{
          id: "rule-1",
          field: "hours",
          operator: "gt",
          value: "0",
        }],
      },
      columns: [
        {
          id: "employee",
          name: "employee",
          title: "Employee",
          role: "category",
          expression: { mode: "field", field: "employee" },
          sorting: "ascending",
          totalMode: "none",
          hidden: false,
        },
        {
          id: "monthSort",
          name: "monthSort",
          title: "Month sort",
          role: "sort",
          expression: { mode: "field", field: "workMonth" },
          sorting: "ascending",
          totalMode: "none",
          hidden: false,
        },
      ],
    };

    const runtime = toRuntimeViewDefinition(resolvedView);

    expect(runtime.id).toBe("hoursByEmployee");
    expect(runtime.title).toBe("Hours by employee");
    expect(runtime.defaultExpand).toBe("collapsed");
    expect(runtime.filter?.mode).toBe("expression");
    expect(runtime.filter?.expression).toMatchObject({
      kind: "operation",
      op: "gt",
    });
    expect(runtime.columns[1]).toMatchObject({
      name: "monthSort",
      role: "display",
      hidden: true,
    });
  });

  it("hides sort columns from the visible column list", () => {
    const resolvedView: MindooDBAppResolvedViewDefinition = {
      id: "v1",
      categorizationStyle: "category_then_document",
      previewMode: "table",
      sources: [],
      filter: {
        mode: "formula",
        expression: { kind: "literal", value: true },
      },
      columns: [
        {
          id: "visible",
          name: "visible",
          title: "Visible",
          role: "display",
          expression: { mode: "field", field: "visible" },
          sorting: "none",
          totalMode: "none",
          hidden: false,
        },
        {
          id: "sortOnly",
          name: "sortOnly",
          title: "Sort only",
          role: "sort",
          expression: { mode: "field", field: "sortOnly" },
          sorting: "ascending",
          totalMode: "none",
          hidden: false,
        },
      ],
    };

    expect(getVisibleViewColumns(resolvedView)).toHaveLength(1);
    expect(getVisibleViewColumns(resolvedView)[0]?.name).toBe("visible");
  });
});
