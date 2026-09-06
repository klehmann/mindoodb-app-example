# MindooDB App Example

A complete reference application for the [MindooDB App SDK](https://github.com/klehmann/mindoodb-app-example), demonstrating every major SDK feature in a working Vue 3 app. Use it to learn how MindooDB apps work, or fork it as a starting point for your own app.

**Live demo:** https://app-example.mindoodb.com (register this URL in Haven to try it)

## What this app demonstrates

The example app covers the full surface of the MindooDB App SDK, organized into three tabs:

### Databases tab -- Documents, history, attachments, and full-text search

- **Database discovery** -- lists all databases Haven mapped into the app session, showing their titles and granted capabilities
- **Capability-aware UI** -- buttons and sections are shown or hidden based on the permissions Haven granted (`read`, `create`, `update`, `delete`, `history`, `attachments`)
- **Document CRUD** -- browse, create (with optional named decryption key), edit with a JSON code editor, and delete documents
- **Full-text search via MindooDB's built-in index** -- enables the database's full-text index over user-selected fields with `db.setFulltextSetup()` (persisted in the synced `dbsetup` document) and searches it with the `text` clause of `documents.query()`. The host keeps the index current automatically; the document list filters results in real time as you type.
- **Document history** -- list all revisions of a document with author and timestamp, load any historical snapshot
- **Attachments** -- upload files via chunked streaming, download, remove, and preview attachments directly in Haven's built-in viewer
- **Attachment previews** -- leverages Haven's native preview for images, PDF, Word (.docx), PowerPoint (.pptx), Excel (.xls/.xlsx), video (with streaming player and seek), audio (with streaming player and seek), and text formats -- all working online and offline

### Views tab -- Virtual Views

- **Haven-configured views** -- lists the view definitions that a Haven administrator attached to the app registration
- **Column metadata** -- displays the dynamic column definitions, roles, and sorting for each view
- **Categorized result grid** -- materializes a paginated, categorized grid for the selected view
- **Navigator cursor** -- step through entries one at a time (first, last, next, prev, parent, first child) with a live "current entry" detail card
- **Expand / Collapse** -- full category expansion control (expand / collapse current entry, expand all, collapse all, toggle individual categories)
- **Category awareness** -- dynamically detects whether the selected view has categories and shows category-specific controls only when relevant

### Events tab -- Theme and viewport

- **Theme tracking** -- displays the current Haven theme mode (light/dark) and preset name, with live updates
- **Viewport tracking** -- shows the current iframe dimensions, updated in real time as the user resizes the app chicklet in Haven
- **Event log** -- records every theme and viewport event since launch, including the initial snapshot

## Tech stack

| | |
|---|---|
| Framework | Vue 3 (Composition API) |
| Build tool | Vite |
| Language | TypeScript |
| UI library | PrimeVue 4 |
| Full-text search | MindooDB built-in full-text index (`documents.query` `text` clause) |
| SDK | `mindoodb-app-sdk` |
| Deployment | Cloudflare Workers (static assets) |

## Get started as a developer

The fastest way to explore the MindooDB platform is to run this app locally and connect it to Haven:

```bash
git clone https://github.com/klehmann/mindoodb-app-example.git
cd mindoodb-app-example
pnpm install
pnpm dev:local
```

This starts a Vite dev server on **http://localhost:4200** with hot module reload. The `dev:local` script sets `LOCAL_MINDOODB=1`, which configures Vite to resolve `mindoodb-app-sdk` and `mindoodb-view-language` from sibling directories -- useful when you are working on the SDK itself.

Then, in Haven:

1. Go to **Application settings** and register a new application with the URL `http://localhost:4200`.
2. Choose a runtime: **iframe** (embedded in Haven) or **window** (separate browser tab).
3. **Map one or more databases** to the app and configure the desired capabilities (read, create, update, delete, history, attachments, views).
4. Optionally **attach view mappings** so the Views tab has something to display.
5. **Launch the app** from Haven. The SDK bridge connects automatically and the app shows live data.

To build your own app, **fork or duplicate** this project. You can develop live inside a running Haven client -- every code change reloads instantly via Vite HMR while the bridge session stays connected.

## Development commands

| Command | Description |
|---|---|
| `pnpm dev` | Start Vite dev server (port 4200), using published SDK packages |
| `pnpm dev:local` | Start Vite dev server, resolving SDK from sibling repos |
| `pnpm build` | Type-check and build production bundle to `dist/` |
| `pnpm build:local` | Build with local SDK resolution |
| `pnpm test` | Run tests with Vitest |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm deploy` | Build and deploy to Cloudflare Workers |
| `pnpm preview` | Build and serve `dist/` with Wrangler (port 4200) |
| `pnpm preview:local` | Same, built with local SDK resolution |

### Hosted mode needs `preview`, not `dev`

Registering this app in Haven as a **hosted bundle** means Haven fetches
`/haven-bundle.json` and `/haven-bundle.zip` from the URL you give it. Both are
produced by `vite build` into `dist/`, so the Vite dev server does not have
them — it answers those paths with `index.html`, and Haven reports
`did not return JSON: Unexpected token '<'`.

The CORS headers those two files need also live in `public/_headers`, which is a
Cloudflare format that Vite ignores entirely. So the dev server cannot serve a
hosted bundle even once the files exist.

Use `pnpm preview:local` (or `pnpm preview`) instead. It serves the built
`dist/` through Wrangler on the same port 4200, with `_headers` applied and a
real 404 for unknown paths. Note that it is a build, not a watch: re-run it
after changing the source.

`pnpm dev` remains the right choice for **external** mode, where Haven just
frames the URL and never fetches a bundle.

## Deployment to Cloudflare

This app is deployed to Cloudflare Workers as a static site. The live demo at https://mindoodb-app-example.mindoo.de uses exactly this setup.

The configuration lives in `wrangler.jsonc`:

```jsonc
{
  "name": "mindoodb-app-example",
  "compatibility_date": "2026-04-09",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "404-page"
  }
}
```

`404-page` rather than `single-page-application`: an SPA fallback answers an
unpublished hashed asset with `index.html` under a cacheable `200`, which stores
HTML at a `.js` address in browser and edge caches. This app has no client-side
routes, so it needs no fallback. See `public/404.html`.

To deploy your own instance:

```bash
pnpm deploy
```

This runs `vue-tsc --noEmit && vite build` followed by `wrangler deploy`, which uploads the `dist/` folder as static assets.

Any static hosting works (Netlify, Vercel, a plain web server), but Cloudflare Workers with static assets is a particularly simple option -- no server configuration, automatic HTTPS, and a generous free tier.

Alternatively, Haven can install the app as a hosted bundle. It then downloads
`haven-bundle.zip` once, keeps it in Cache Storage, and serves it from a service
worker — so the app starts without a network connection and gets its own browser
origin, isolated from Haven and from every other installed app.

## Project structure

```text
src/
  app/
    useMindooDBDemoApp.ts       Root orchestrator: session lifecycle, shared state, cross-tab wiring
    useDocumentsSection.ts      Documents tab: CRUD, history, attachments, full-text search
    useViewsSection.ts          Views tab: navigator traversal, expansion, batched entry reading
    useEventsSection.ts         Events tab: host theme/viewport tracking, event log
    useMindooDBDemoApp.test.ts  Integration tests using the SDK mock bridge
  assets/styles/                Global Mindoo theme styling (CSS custom properties)
  features/
    databases/                  Document CRUD, history, attachment UI, and full-text search
    events/                     Theme and viewport event display and logging
    views/                      Haven view rendering helpers and categorized grid UI
  lib/                          Theme bootstrap (PrimeVue theme integration)
  shared/components/            Reusable components (JSON code editor)
```

The app is organized by feature so each SDK integration area is easy to find and study independently.

## Testing

The test suite is intentionally focused on the non-trivial integration points:

- **`src/app/useMindooDBDemoApp.test.ts`** -- verifies the shared app controller (including query-based full-text search) using the SDK's `createMockMindooDBAppBridge` helpers from `mindoodb-app-sdk/testing`
- **`src/features/views/lib/runtimeViews.test.ts`** -- verifies the adapter logic that transforms Haven-configured view definitions into runtime view shapes

Run the tests:

```bash
pnpm test
```

For guidance on testing your own MindooDB apps, see the [SDK testing documentation](https://github.com/klehmann/mindoodb-app-sdk/blob/main/TESTING.md).

## License

Licensed under the [Apache License, Version 2.0](./LICENSE). Copyright 2026
Mindoo GmbH.
