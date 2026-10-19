import type { MindooDBAppComponentInfo } from "mindoodb-app-sdk";
import type { MockMindooDBAppDatabaseDefinition } from "mindoodb-app-sdk/testing";

/**
 * Documents the test host starts with, per logical database id from haven-app.json.
 * Mock data only: it never reaches a real Haven and is gone on reload.
 */
export const seedDocuments: Record<string, MockMindooDBAppDatabaseDefinition["documents"]> = {
  sdkexample: [],
};

/**
 * The editors of TeamEdit, TeamGrid and TeamSlides as Haven lists them when those
 * apps are installed (`session.components.list`), copied from their haven-app.json
 * (`createFields` is `create` plus `match`). The test host draws a stand-in with
 * Done/Cancel buttons instead of the real editor.
 */
export const seedComponents: MindooDBAppComponentInfo[] = [
  {
    key: "teamedit/word",
    appInstanceId: "teamedit",
    appId: "mindoodb-app-teamedit",
    appLabel: "Mindoo TeamEdit",
    componentId: "word",
    label: "Word document",
    category: "editor",
    intents: ["create", "edit", "view"],
    match: { form: "teamedit", type: "word" },
    createFields: { subject: "", tags: [], istemplate: false, comments: [], form: "teamedit", type: "word" },
    children: { linkField: "parentId", match: { type: "wordChunk" } },
  },
  {
    key: "teamgrid/spreadsheet",
    appInstanceId: "teamgrid",
    appId: "mindoodb-app-teamgrid",
    appLabel: "Mindoo TeamGrid",
    componentId: "spreadsheet",
    label: "Spreadsheet",
    category: "editor",
    intents: ["create", "edit", "view"],
    match: { form: "teamgrid-next" },
    createFields: { subject: "", tags: [], istemplate: false, form: "teamgrid-next" },
    children: { linkField: "parentId", match: { type: "gridChunk" } },
  },
  {
    key: "teamslides/presentation",
    appInstanceId: "teamslides",
    appId: "mindoodb-app-teamslides",
    appLabel: "Mindoo TeamSlides",
    componentId: "presentation",
    label: "Presentation",
    category: "editor",
    intents: ["create", "edit", "view"],
    match: { type: "teamslides.deck" },
    createFields: { title: "", subject: "", tags: [], type: "teamslides.deck" },
    children: { linkField: "deckId", match: { type: "teamslides.slide" } },
  },
];
