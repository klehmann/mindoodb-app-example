/**
 * Which editors of other apps the example embeds, and how their documents look in
 * the example's own database.
 *
 * An app that offers an editor declares it as a *component* in its haven-app.json
 * (TeamEdit: `word`, TeamGrid: `spreadsheet`, TeamSlides: `presentation`). Haven
 * lists the components of all installed apps (`session.components.list`); the
 * example picks the three it wants by app id and component id. The component key
 * Haven returns is opaque and differs per installation, so never hard-code it.
 *
 * A document of such an editor is a *root document* in the example's database
 * that carries the component's `match` fields (e.g. `form: "teamedit"`,
 * `type: "word"`), plus *children* the editor creates itself (the chunks of a Word
 * document, the slides of a presentation). The example only creates the root; the
 * editor fills it in.
 *
 * @module embeddedEditors
 */
import type { MindooDBAppComponentChildren, MindooDBAppComponentInfo } from "mindoodb-app-sdk";
import { t, type MessageKey } from "@/i18n";

import appDefinition from "../../../../public/haven-app.json";

/** The database the embedded documents live in: the example's own, `sdkexample`. */
export const EMBEDS_DATABASE_ID = appDefinition.defaultLaunchDatabaseId;

export type EmbeddedEditorKind = "word" | "spreadsheet" | "presentation";

export interface EmbeddedEditorSpec {
  kind: EmbeddedEditorKind;
  /** `appId` and component `id` from the providing app's haven-app.json. */
  appId: string;
  componentId: string;
  /** For messages while the app is not installed (Haven then has no label for it). */
  appName: string;
  /** Texts in src/i18n: what one document is called, and the "New …" button. */
  nounKey: MessageKey;
  newKey: MessageKey;
}

/** The three editors this tab offers. */
export const EMBEDDED_EDITORS: readonly EmbeddedEditorSpec[] = [
  { kind: "word", appId: "mindoodb-app-teamedit", componentId: "word", appName: "TeamEdit", nounKey: "nounWord", newKey: "newWord" },
  { kind: "spreadsheet", appId: "mindoodb-app-teamgrid", componentId: "spreadsheet", appName: "TeamGrid", nounKey: "nounSpreadsheet", newKey: "newSpreadsheet" },
  { kind: "presentation", appId: "mindoodb-app-teamslides", componentId: "presentation", appName: "TeamSlides", nounKey: "nounPresentation", newKey: "newPresentation" },
];

/**
 * Fields the example adds to a root document. Components keep fields they do not
 * know, so a host may store its own data on the root; give them a prefix of your
 * app so they never collide with the editor's fields.
 *
 * `exampleEditor` is a top-level string, so it is in the database's summary buffer
 * by default and `documents.query` / `liveQuery` can filter on it without loading
 * documents. The list works from it even while the editor's app is not installed
 * (then the component and its `match` fields are unknown).
 */
export const EDITOR_FIELD = "exampleEditor";
/**
 * The component's `children` link, copied at creation: deleting the document must
 * also delete its children, even after the editor's app was uninstalled.
 */
export const CHILDREN_FIELD = "exampleChildren";
/** All three editors keep the document title in `subject`. */
export const TITLE_FIELD = "subject";

export function editorSpec(kind: unknown): EmbeddedEditorSpec | null {
  return EMBEDDED_EDITORS.find((spec) => spec.kind === kind) ?? null;
}

/** The installed component for `spec`, or null when its app is not installed. */
export function findComponent(
  components: readonly MindooDBAppComponentInfo[],
  spec: EmbeddedEditorSpec,
): MindooDBAppComponentInfo | null {
  return components.find((entry) => entry.appId === spec.appId && entry.componentId === spec.componentId) ?? null;
}

/**
 * The fields of a new root document: the component's `createFields` (its `create`
 * defaults plus its `match` fields, so the component accepts the document), the
 * title, and the example's own fields.
 */
export function newDocumentFields(
  component: MindooDBAppComponentInfo,
  spec: EmbeddedEditorSpec,
  title: string,
): Record<string, unknown> {
  // Copy before changing. JSON rather than `structuredClone`: the component usually
  // comes out of Vue state, and `structuredClone` throws on Vue's reactive proxies.
  const fields = JSON.parse(JSON.stringify(component.createFields)) as Record<string, unknown>;
  fields[TITLE_FIELD] = title;
  // TeamSlides also has a `title` field; fill every empty title field the editor declares.
  if ("title" in fields && !fields.title) {
    fields.title = title;
  }
  fields[EDITOR_FIELD] = spec.kind;
  if (component.children) {
    fields[CHILDREN_FIELD] = JSON.parse(JSON.stringify(component.children)) as unknown;
  }
  return fields;
}

/** Query filter (view language source) for the example's embedded documents. */
export function embeddedDocumentsFilter() {
  const kinds = EMBEDDED_EDITORS.map((spec) => `v.eq(v.field("${EDITOR_FIELD}"), "${spec.kind}")`);
  return `v.or(${kinds.join(", ")})`;
}

/** Query filter for the children of `rootId`, from a stored or declared `children` link. */
export function childrenFilter(children: MindooDBAppComponentChildren, rootId: string) {
  const conditions = [
    `v.eq(v.field(${JSON.stringify(children.linkField)}), ${JSON.stringify(rootId)})`,
    ...Object.entries(children.match ?? {}).map(
      ([field, value]) => `v.eq(v.field(${JSON.stringify(field)}), ${JSON.stringify(value)})`,
    ),
  ];
  return conditions.length === 1 ? conditions[0]! : `v.and(${conditions.join(", ")})`;
}

/** Reads a stored `children` link back; null when the document has none. */
export function readChildren(value: unknown): MindooDBAppComponentChildren | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const { linkField, match } = value as Partial<MindooDBAppComponentChildren>;
  return typeof linkField === "string" && linkField
    ? { linkField, ...(match && typeof match === "object" ? { match } : {}) }
    : null;
}

/** A readable message for errors of `embeds.open` (Haven's error codes are the `name`). */
export function describeOpenError(error: unknown, spec: EmbeddedEditorSpec | null): string {
  const name = error instanceof Error ? error.name : "";
  const app = spec?.appName ?? t("theEditorsApp");
  switch (name) {
    case "declined":
      return t("openDeclined", { app });
    case "component-not-found":
      return t("openComponentNotFound", { app });
    case "forbidden":
      return t("openForbidden");
    case "unsupported":
    case "method-not-found":
      return t("openUnsupported");
    default:
      return error instanceof Error ? error.message : String(error);
  }
}
