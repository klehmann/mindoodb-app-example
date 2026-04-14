/**
 * Adapter layer that converts **Haven-configured view definitions**
 * (`MindooDBAppResolvedViewDefinition`) into the **runtime view definitions**
 * (`MindooDBAppViewDefinition`) that the SDK's navigator APIs expect.
 *
 * Haven stores view definitions in a user-friendly authoring format -- visual
 * filter rules, field-or-formula column expressions, a "sort" column role, etc.
 * The SDK bridge, however, works with a normalised expression-based format.
 * This module bridges the gap so the example app can render Haven-managed views
 * through the same view-handle API used for app-defined views.
 *
 * The three exported helpers are:
 * - `toRuntimeViewDefinition` -- full authoring-to-runtime conversion
 * - `getPrimaryViewSource` -- pick the first source from a multi-source view
 * - `getVisibleViewColumns` -- filter out hidden columns for display
 */

import type {
  MindooDBAppBooleanExpression,
  MindooDBAppConfiguredViewFilterDefinition,
  MindooDBAppConfiguredViewFilterRule,
  MindooDBAppExpression,
  MindooDBAppResolvedViewDefinition,
  MindooDBAppResolvedViewSource,
  MindooDBAppViewDefinition,
} from "mindoodb-app-sdk";

/** Build a `field` expression node referencing a document property by path. */
function fieldExpression(path: string): MindooDBAppExpression {
  return {
    kind: "field",
    path,
  };
}

function literalExpression(value: unknown): MindooDBAppExpression {
  return {
    kind: "literal",
    value,
  };
}

function operationExpression(op: string, args: MindooDBAppExpression[]): MindooDBAppExpression {
  return {
    kind: "operation",
    op: op as never,
    args,
  };
}

/**
 * Convert one visual filter rule (e.g. "field eq value") into the
 * equivalent expression-tree node.  `notContains` is desugared into
 * `not(contains(...))` since the expression language has no dedicated operator.
 */
function ruleToExpression(rule: MindooDBAppConfiguredViewFilterRule): MindooDBAppBooleanExpression {
  const field = fieldExpression(rule.field);
  switch (rule.operator) {
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "contains":
      return operationExpression(rule.operator, [field, literalExpression(rule.value ?? "")]) as MindooDBAppBooleanExpression;
    case "notContains":
      return operationExpression("not", [
        operationExpression("contains", [field, literalExpression(rule.value ?? "")]),
      ]) as MindooDBAppBooleanExpression;
    case "exists":
      return operationExpression("exists", [field]) as MindooDBAppBooleanExpression;
    case "notExists":
      return operationExpression("notExists", [field]) as MindooDBAppBooleanExpression;
    default:
      return literalExpression(true) as MindooDBAppBooleanExpression;
  }
}

/**
 * Convert a complete Haven filter definition (rules or formula) into the
 * `{ mode: "expression", expression }` shape the runtime view expects.
 * Multiple rules are combined with `and` or `or` depending on the match mode.
 */
function filterToExpression(filter: MindooDBAppConfiguredViewFilterDefinition | undefined) {
  if (!filter) {
    return undefined;
  }

  if (filter.mode === "formula") {
    return {
      mode: "expression" as const,
      expression: structuredClone(filter.expression),
    };
  }

  const expressions = filter.rules.map(ruleToExpression);
  if (!expressions.length) {
    return undefined;
  }

  return {
    mode: "expression" as const,
    expression: expressions.length === 1
      ? expressions[0]
      : operationExpression(filter.match === "all" ? "and" : "or", expressions) as MindooDBAppBooleanExpression,
  };
}

/**
 * Convert a Haven-configured view into a runtime `MindooDBAppViewDefinition`.
 *
 * Key transformations:
 * - Visual-rule filters become a single boolean expression tree.
 * - The Haven `"sort"` column role is mapped to `"display"` (the runtime
 *   schema applies sorting via the `sorting` property, not the role).
 * - Field-mode column expressions are expanded to expression nodes;
 *   formula-mode expressions are passed through as-is.
 * - `previewMode` is mapped to `defaultExpand` (`"tree"` -> collapsed).
 */
export function toRuntimeViewDefinition(view: MindooDBAppResolvedViewDefinition): MindooDBAppViewDefinition {
  return {
    id: view.id,
    title: view.description?.trim() || view.id,
    filter: filterToExpression(view.filter),
    defaultExpand: view.previewMode === "tree" ? "collapsed" : "expanded",
    columns: view.columns.map((column) => ({
      name: column.name,
      title: column.title,
      role: column.role === "sort" ? "display" : column.role,
      expression: column.expression.mode === "field"
        ? fieldExpression(column.expression.field)
        : structuredClone(column.expression.expression),
      sorting: column.sorting,
      hidden: column.hidden,
      totalMode: column.totalMode,
    })),
  };
}

/** Return the first source binding, or `null` if the view has no sources. */
export function getPrimaryViewSource(view: MindooDBAppResolvedViewDefinition): MindooDBAppResolvedViewSource | null {
  return view.sources[0] ?? null;
}

/** Filter out columns marked as hidden so only displayable columns remain. */
export function getVisibleViewColumns(view: MindooDBAppResolvedViewDefinition) {
  return view.columns.filter((column) => !column.hidden);
}
