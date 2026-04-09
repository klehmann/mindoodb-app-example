# MindooDB App Example

A complete reference application for the [MindooDB App SDK](https://github.com/klehmann/mindoodb-app-example), demonstrating every major SDK feature in a working Vue 3 app. Use it to learn how MindooDB apps work, or fork it as a starting point for your own app.

**Live demo:** https://app-example.mindoodb.com (register this URL in Haven to try it)

## What this app demonstrates

The example app covers the full surface of the MindooDB App SDK, organized into three tabs:

### Databases tab -- Documents, history, attachments, and full-text search

- **Database discovery** -- lists all databases Haven mapped into the app session, showing their titles and granted capabilities
- **Capability-aware UI** -- buttons and sections are shown or hidden based on the permissions Haven granted (`read`, `create`, `update`, `delete`, `history`, `attachments`)
- **Document CRUD** -- browse, create (with optional named decryption key), edit with a JSON code editor, and delete documents
- **Full-text search with cursor-based incremental loading** -- builds an in-memory [FlexSearch](https://github.com/nextapps-de/flexsearch) index over user-selected document fields. The initial index is populated by paginating through the SDK's `documents.list` API with cursor-based iteration, and subsequent updates replay only the changes since the last cursor checkpoint. The document list filters results in real time as you type.
- **Document history** -- list all revisions of a document with author and timestamp, load any historical snapshot
- **Attachments** -- upload files via chunked streaming, download, remove, and preview attachments directly in Haven's built-in viewer
- **Attachment previews** -- leverages Haven's native preview for images, PDF, Word (.docx), PowerPoint (.pptx), Excel (.xls/.xlsx), video (with streaming player and seek), audio (with streaming player and seek), and text formats -- all working online and offline

### Views tab -- Virtual Views

- **Haven-configured views** -- lists the view definitions that a Haven administrator attached to the app registration
- **Column metadata** -- displays the dynamic column definitions, roles, and sorting for each view
- **Categorized result grid** -- materializes a paginated, categorized grid for the selected view
- **Expand / Collapse** -- full category expansion control (expand all, collapse all, toggle individual categories)

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
| Full-text search | [FlexSearch](https://github.com/nextapps-de/flexsearch) (in-memory document index) |
| SDK | `mindoodb-app-sdk` |
| Deployment | Cloudflare Workers (static assets) |

## Get started as a developer

The fastest way to explore the MindooDB platform is to run this app locally and connect it to Haven:

```bash
git clone https://github.com/klehmann/mindoodb-app-example.git
cd mindoodb-app-example
npm install
npm run dev:local
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
| `npm run dev` | Start Vite dev server (port 4200), using published SDK packages |
| `npm run dev:local` | Start Vite dev server, resolving SDK from sibling repos |
| `npm run build` | Type-check and build production bundle to `dist/` |
| `npm run build:local` | Build with local SDK resolution |
| `npm test` | Run tests with Vitest |
| `npm run test:watch` | Run tests in watch mode |
| `npm run deploy` | Build and deploy to Cloudflare Workers |
| `npm run preview` | Build and preview with local Wrangler dev server |

## Deployment to Cloudflare

This app is deployed to Cloudflare Workers as a static site. The live demo at https://mindoodb-app-example.mindoo.de uses exactly this setup.

The configuration lives in `wrangler.jsonc`:

```jsonc
{
  "name": "mindoodb-app-example",
  "compatibility_date": "2026-04-09",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application"
  }
}
```

To deploy your own instance:

```bash
npm run deploy
```

This runs `vue-tsc --noEmit && vite build` followed by `wrangler deploy`, which uploads the `dist/` folder as static assets with SPA fallback routing.

Any static hosting works (Netlify, Vercel, a plain web server), but Cloudflare Workers with static assets is a particularly simple option -- no server configuration, automatic HTTPS, and a generous free tier.

Alternatively, Haven can host app bundles directly via its service worker. Haven-hosted apps load without a network connection and run in a stricter sandbox with an opaque origin.

## Project structure

```text
src/
  app/                    Shared app controller (useMindooDBDemoApp) and top-level shell
  assets/styles/          Global Mindoo theme styling (CSS custom properties)
  features/
    databases/            Document CRUD, history, attachment UI, and full-text search
      lib/searchIndex.ts  FlexSearch-based index with cursor-based incremental sync
    events/               Theme and viewport event display and logging
    views/                Haven view rendering helpers and categorized grid UI
  lib/                    Theme bootstrap (PrimeVue theme integration)
  shared/components/      Reusable components (JSON code editor)
```

The app is organized by feature so each SDK integration area is easy to find and study independently.

## Testing

The test suite is intentionally focused on the non-trivial integration points:

- **`src/app/useMindooDBDemoApp.test.ts`** -- verifies the shared app controller using the SDK's `createMockMindooDBAppBridge` helpers from `mindoodb-app-sdk/testing`
- **`src/features/databases/lib/searchIndex.test.ts`** -- verifies full-text index creation, incremental cursor-based sync, and search across mixed JSON field types
- **`src/features/views/lib/runtimeViews.test.ts`** -- verifies the adapter logic that transforms Haven-configured view definitions into runtime view shapes

Run the tests:

```bash
npm test
```

For guidance on testing your own MindooDB apps, see the [SDK testing documentation](https://github.com/klehmann/mindoodb-app-sdk/blob/main/TESTING.md).