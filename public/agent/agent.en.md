# Working with the MindooDB SDK Example app

The example app shows documents of one MindooDB database (usually "SDK Example database"). A document is a free-form JSON object; there is no fixed schema. The app's tools appear only while it runs; parameter details are in each tool's description.

## Where ids come from

- `docId`: `example_documents_list`, the `docId` that `example_document_create` returns, or `selectedDocId` in `example_get_context` ("this document").
- `undoStepId`: returned by every write tool.

Never invent ids.

## Typical steps

1. `example_get_context`: the open database, whether it is read-only, the field names documents use (`fieldNames`) and the selected document.
2. Find documents with `example_documents_list`: `where` for exact values (`{"status": "open"}`), `text` for a topic search. If the result says `textSearch` is substring, the full-text index is off and only literal words matched.
3. Read one completely with `example_document_get`.
4. Write with `example_document_create`, `example_document_update` (`set` and `unset`; other fields stay) or `example_document_delete` (Haven asks the user first). Reuse the field names other documents use.

## Undo

Every write is one undo step. `example_undo` with the `undoStepId` takes it back; deleted documents come back with the same docId. If the document changed since, undo is refused with STATE_CHANGED: tell the user and pass `force` only if they agree.

## Pitfalls

- During time travel the app is read-only and every write is refused.
- `example_users_search` needs the directory permission on the database; if it is refused, ask the user to grant it in Haven.
- The tools work on the database open in the app. To work on another one, ask the user to switch it in the Databases tab.
