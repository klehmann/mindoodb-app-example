import type {
  MindooDBAppBooleanExpression,
  MindooDBAppConfiguredViewFilterDefinition,
  MindooDBAppConfiguredViewFilterRule,
  MindooDBAppExpression,
  MindooDBAppResolvedViewDefinition,
  MindooDBAppResolvedViewSource,
  MindooDBAppViewDefinition,
} from "mindoodb-app-sdk";

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
      hidden: column.role === "sort" ? true : column.hidden,
      totalMode: column.totalMode,
    })),
  };
}

export function getPrimaryViewSource(view: MindooDBAppResolvedViewDefinition): MindooDBAppResolvedViewSource | null {
  return view.sources[0] ?? null;
}

export function getVisibleViewColumns(view: MindooDBAppResolvedViewDefinition) {
  return view.columns.filter((column) => !column.hidden && column.role !== "sort");
}
