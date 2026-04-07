# MindooDB App Example

This project is a small demo application for **MindooDB Haven**. It shows how a hosted app can use the **MindooDB App SDK** to:

- list the databases mapped into the app session
- perform generic JSON document CRUD
- inspect document history when the host allows it
- upload, remove, and extract attachments
- render Haven-provided view mappings in a categorized result UI
- react to host theme and viewport resize events

The app intentionally mirrors the basic look and feel of the `mindoodb-timerecords` sample while keeping the code organized by feature so the SDK is easier to explore.

## Tech stack

- Vue 3
- Vite
- TypeScript
- PrimeVue 4
- `mindoodb-app-sdk`
- `mindoodb-view-language`

## Development

Install dependencies:

```bash
npm install
```

Run the development server on port `4174`:

```bash
npm run dev
```

Build the production bundle:

```bash
npm run build
```

Run the tests:

```bash
npm test
```

## Launching from Haven

1. Run Haven locally.
2. Start this app with `npm run dev`.
3. Register the app in Haven with an entry URL such as `http://localhost:4174`.
4. Map one or more databases to the app.
5. Optionally attach Haven view mappings to the app registration.
6. Launch the app from Haven so the SDK bridge can establish a session.

The app expects Haven to supply the launch id in the URL and establish the `postMessage` bridge handshake.

## App structure

```text
src/
  app/                    Shared app controller and top-level shell
  assets/styles/          Global Mindoo theme styling
  features/
    databases/            CRUD, history, and attachment UI
    events/               Theme and viewport event presentation
    views/                Haven view mapping rendering helpers and UI
  lib/                    Theme bootstrap
  shared/components/      Reusable components such as the JSON editor
```

## Tabs

### Databases

The `Databases` tab is a generic document workbench:

- pick a mapped database
- browse the returned documents
- create or update raw JSON documents
- delete documents when the capability is granted
- inspect revision history through `documents.listHistory()` and `documents.getAtTimestamp()`
- manage attachments through the stream-based attachment APIs

The UI is capability-aware, so history and attachment areas explain when the host mapping does not allow those operations.

### Views

The `Views` tab uses `launchContext.views` from the SDK. It:

- lists the Haven-managed view definitions attached to the app registration
- displays their dynamic column metadata
- materializes a categorized result grid for the selected view
- supports `Expand all` and `Collapse all`

For now, the demo renders the first mapped source when a Haven view uses multiple sources. The UI makes that limitation explicit.

### Events

The `Events` tab displays:

- the current host theme
- the current viewport dimensions
- an event log of the initial launch snapshot plus live theme and viewport updates

## Testing approach

The tests are intentionally focused:

- `src/app/useMindooDBDemoApp.test.ts` verifies the shared controller behavior with the SDK's mock bridge helpers
- `src/features/views/lib/runtimeViews.test.ts` verifies the Haven-view to runtime-view adapter logic

This keeps the sample app readable while still protecting the non-trivial integration points.
