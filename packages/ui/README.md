# @pg-workflows/ui

React dashboard and HTTP adapters for [pg-workflows](https://github.com/SokratisVidros/pg-workflows) — browse, monitor, and manage workflow runs, or build your own UI on the headless hooks. It talks to your `WorkflowEngine` through a small, framework-agnostic HTTP layer, so the browser never touches your database.

This guide is for developers integrating the UI into an app. It covers installation and every entry-point variant.

---

## Install

```bash
npm install @pg-workflows/ui
```

Peer dependencies you provide in your app:

```bash
npm install react react-dom @tanstack/react-query tailwindcss pg-workflows
```

| Peer | Range | Why |
|------|-------|-----|
| `react`, `react-dom` | `>=18` | components + hooks |
| `@tanstack/react-query` | `>=5` | data fetching/caching in the hooks |
| `tailwindcss` | `^4` | components are styled with Tailwind v4 utilities + design tokens |
| `pg-workflows` | `>=0.13.0` | the engine the server adapter drives (server-side only) |

> Ships compiled ESM with type declarations, so no TypeScript/JSX transpilation of `node_modules` is needed. Module structure is preserved rather than bundled, which keeps the `'use client'` directives intact for the React Server Components boundary — you can import the dashboard from a server component in the Next.js App Router.

---

## Entry points

The package is split so client code never pulls in server/engine code:

| Import | Contents | Runs |
|--------|----------|------|
| `@pg-workflows/ui` | Dashboard component, all components, hooks, provider, client re-export | client |
| `@pg-workflows/ui/client` | `createFetchClient` + types (no React) | client or server |
| `@pg-workflows/ui/server` | `createWorkflowRunsApi`, `toNodeHandler` — the HTTP adapter over your engine | server only |
| `@pg-workflows/ui/next` | `createRouteHandlers` (App Router), `createPagesApiHandler` (Pages Router) | server only |
| `@pg-workflows/ui/tailwind` | Tailwind preset exposing the `pgw-*` color tokens | build |
| `@pg-workflows/ui/styles.css` | CSS variables (light/dark) + base styles | client |
| `pg-workflows-ui` (bin) | Standalone localhost dashboard — see Variant 3 | CLI |

The architecture: **browser → hooks → HTTP → server adapter → `WorkflowEngine` → Postgres.**

---

## Styling setup (required once)

The components use Tailwind v4 utilities plus `pgw-*` design tokens, so your Tailwind build must (1) see the package's classes and (2) know the tokens.

In your global CSS:

```css
@import 'tailwindcss';
@import '@pg-workflows/ui/styles.css';          /* --pgw-* variables (light + dark) + .pgw-root base */

/* Let Tailwind generate the utility classes the components use: */
@source '../node_modules/@pg-workflows/ui/dist';
```

If you use a JS Tailwind config instead, add the preset (for the `pgw-*` colors) and include the package in `content`:

```ts
import pgwPreset from '@pg-workflows/ui/tailwind'
export default {
  presets: [pgwPreset],
  content: ['./node_modules/@pg-workflows/ui/dist/**/*.js', /* your files */],
}
```

Dark mode works out of the box via `prefers-color-scheme` on the `--pgw-*` variables — see [Theming](#theming).

---

## Variant 1 — Drop-in dashboard

The fastest path. `<WorkflowRunsDashboard/>` is self-contained: it creates its own React Query client and provider, renders the runs list, and navigates to a run detail page (timeline, per-step input/output, and lifecycle actions).

```tsx
'use client'
import '@pg-workflows/ui/styles.css'
import { WorkflowRunsDashboard } from '@pg-workflows/ui'

export default function RunsPage() {
  // `baseUrl` points at where you mounted the server routes (Variant 2).
  return <WorkflowRunsDashboard baseUrl="/workflow-runs" />
}
```

Props (`WorkflowRunsDashboardProps`):

- `baseUrl: string` **or** `client: WorkflowRunsClient` — where/how to reach the API (exactly one).
- `pollIntervalMs?: number` — live-refresh interval (default 5000; `0` disables).
- `selectedRunId?: string | null` + `onSelectRun?: (id: string | null) => void` — optional controlled selection (wire to your router for deep-linkable runs).
- `className?: string`.

You still need the server routes from Variant 2 for it to have data.

---

## Variant 2 — Server adapter

`createWorkflowRunsApi` maps HTTP requests onto your engine's management API (list/get runs + cancel/pause/resume/fast-forward/trigger). It's built on Web-standard `Request`/`Response`, so it drops into any modern server; a `toNodeHandler` bridges to Node `(req, res)`.

```ts
import { createWorkflowRunsApi } from '@pg-workflows/ui/server'
import { engine } from '@/lib/engine' // your started WorkflowEngine

export const runsApi = createWorkflowRunsApi({
  engine,
  // basePath?: '/workflow-runs'            // defaults to '/workflow-runs'
  // resolveContext?: (req) => ({ resourceId })   // see Security below
})
```

### Next.js — App Router

`createRouteHandlers(api)` returns one handler per route:

```ts
// app/workflow-runs/[id]/cancel/route.ts
import { runsApi } from '@/lib/runs-api'
import { createRouteHandlers } from '@pg-workflows/ui/next'
const h = createRouteHandlers(runsApi)
export const POST = h.cancel
```

Full route tree (`h` = `createRouteHandlers(runsApi)`):

| File | Export |
|------|--------|
| `app/workflow-runs/route.ts` | `export const GET = h.list` |
| `app/workflow-runs/[id]/route.ts` | `export const GET = h.detail` |
| `app/workflow-runs/[id]/cancel/route.ts` | `export const POST = h.cancel` |
| `app/workflow-runs/[id]/pause/route.ts` | `export const POST = h.pause` |
| `app/workflow-runs/[id]/resume/route.ts` | `export const POST = h.resume` |
| `app/workflow-runs/[id]/fast-forward/route.ts` | `export const POST = h.fastForward` |
| `app/workflow-runs/[id]/trigger/route.ts` | `export const POST = h.trigger` |

Then point the dashboard at it: `<WorkflowRunsDashboard baseUrl="/workflow-runs" />`. (Handlers support both Next 14 sync and Next 15 async `params`.)

> A complete working version of this setup — route tree, engine singleton, and a seed script covering every run state — lives in [`examples/dashboard`](../../examples/dashboard).

### Next.js — Pages Router

One catch-all API route. Create the api with a `basePath` matching the mount:

```ts
// pages/api/workflow-runs/[[...path]].ts
import { createWorkflowRunsApi } from '@pg-workflows/ui/server'
import { createPagesApiHandler } from '@pg-workflows/ui/next'
import { engine } from '@/lib/engine'

const api = createWorkflowRunsApi({ engine, basePath: '/api/workflow-runs' })
export default createPagesApiHandler(api)
```

Use `<WorkflowRunsDashboard baseUrl="/api/workflow-runs" />`.

### TanStack Start / Hono / Bun / Deno / Cloudflare Workers

Any Web-standard server can call `api.fetch(request)` directly:

```ts
// e.g. a TanStack Start server route or a Hono handler
import { runsApi } from '@/lib/runs-api'
export const handler = (request: Request) => runsApi.fetch(request)
```

### Express / Node

Bridge the Web handler to Node with `toNodeHandler`:

```ts
import express from 'express'
import { toNodeHandler } from '@pg-workflows/ui/server'
import { runsApi } from './runs-api'

const app = express()
app.use('/workflow-runs', toNodeHandler(runsApi.fetch)) // create the api with basePath: '/workflow-runs'
```

### Vite / SPA (no server of your own)

The client + hooks are pure React — host the dashboard in a Vite SPA and point it at an API served by any of the targets above (e.g. a separate Node/Hono service): `<WorkflowRunsDashboard baseUrl="https://api.example.com/workflow-runs" />`.

---

## Variant 3 — `npx` standalone (no app at all)

To inspect runs without integrating anything, run the bundled dashboard straight
against a database:

```bash
npx @pg-workflows/ui --database-url=postgres://… [--port=3777]
```

It starts an engine, mounts the adapter at `/workflow-runs`, and serves a
prebuilt SPA. `DATABASE_URL` works instead of the flag.

> **Binds `127.0.0.1` only, with no authentication and no `resolveContext`** —
> every run in that database is readable *and mutable* by anyone who can reach
> the port. Localhost is the entire trust boundary; don't put it behind a tunnel
> or a reverse proxy.

Actions (cancel/pause/resume/fast-forward/trigger) are live, but this process
registers no workflow definitions — it drives runs owned by whichever app does.

---

## Variant 4 — Headless (build your own UI)

Everything the dashboard uses is exported, so you can compose your own interface. Provide a client via `WorkflowRunsProvider`, then use the hooks:

```tsx
'use client'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import {
  WorkflowRunsProvider, createFetchClient,
  useWorkflowRuns, useWorkflowRun, useRunFilters,
  useCancelRun, usePauseRun, useResumeRun, useFastForwardRun, useTriggerEvent,
} from '@pg-workflows/ui'

const qc = new QueryClient()
const client = createFetchClient({ baseUrl: '/workflow-runs' })

function App() {
  return (
    <QueryClientProvider client={qc}>
      <WorkflowRunsProvider client={client} pollIntervalMs={5000}>
        <MyRunsView />
      </WorkflowRunsProvider>
    </QueryClientProvider>
  )
}

function MyRunsView() {
  const { serverParams } = useRunFilters()
  const { data } = useWorkflowRuns(serverParams)   // { items, nextCursor, prevCursor, hasMore, hasPrev }
  const cancel = useCancelRun()                    // cancel.mutate({ id })
  return /* your markup */ null
}
```

**Query hooks:** `useWorkflowRuns(params)`, `useWorkflowRun(id)`, `useRunFilters(initial?)`, `useWorkflowRunsClient()`.
**Mutation hooks:** `useCancelRun`, `usePauseRun`, `useResumeRun`, `useFastForwardRun`, `useTriggerEvent` — each `.mutate({ id, ... })` and invalidates the relevant queries on success.
**Building blocks (all exported):** `RunsTable`, `Pagination`, `RunDetail`, `StatusBadge`, `StatusSummary`, `RunProgress`, `StepTimeline`, `FilterBar`, `LiveIndicator`, `JsonViewer`, `RunDetailHeader`.

You can also skip React entirely and call `createFetchClient({ baseUrl })` from `@pg-workflows/ui/client` (`listRuns`, `getRun`, `cancelRun`, `pauseRun`, `resumeRun`, `fastForwardRun`, `triggerEvent`).

---

## Theming

Three layers, in order of how you'll reach for them:

1. **CSS variables (primary).** After importing `@pg-workflows/ui/styles.css`, override any token in your own `:root`/scope:

   ```css
   :root {
     --pgw-accent: #6d28d9;
     --pgw-status-running: #2563eb;
     /* --pgw-bg, --pgw-fg, --pgw-muted, --pgw-muted-fg, --pgw-border,
        --pgw-status-{completed,failed,running,paused,cancelled,pending} */
   }
   ```
   A `prefers-color-scheme: dark` block ships defaults, so **dark mode is automatic**.

2. **Tailwind preset** (`@pg-workflows/ui/tailwind`) exposes the tokens as utilities (`bg-pgw-bg`, `text-pgw-status-running`, `border-pgw-border`) for your own markup.

3. **`className` + `.pgw-root`.** Every component accepts a `className`; the `.pgw-root` class sets base background/foreground/font (the dashboard applies it for you).

---

## Security & multi-tenancy

The adapter does **not** own authentication — protect the routes with your app's own middleware. It owns **scoping** via the optional `resolveContext` hook:

```ts
createWorkflowRunsApi({
  engine,
  resolveContext: (req) => ({ resourceId: getTenantFromSession(req) }), // throw → 401
})
```

The resolved `resourceId` is passed to every read and every action, so a caller can only see and act on their own runs. `resourceId` is never read from the client.

> ⚠️ **Open by default.** With no `resolveContext`, the adapter exposes and mutates **all runs across all tenants**. That's intended for single-tenant/internal dashboards behind your own auth. For anything multi-tenant, always supply `resolveContext`.

---

## HTTP reference

All under `basePath` (default `/workflow-runs`); `:id` is the run id.

| Method & path | Engine call |
|---------------|-------------|
| `GET /` | `getRuns` (query: `starting_after`, `ending_before`, `limit`, `workflow_id`, `statuses[]`) |
| `GET /:id` | `getRun` |
| `POST /:id/cancel` | `cancelWorkflow` |
| `POST /:id/pause` | `pauseWorkflow` |
| `POST /:id/resume` | `resumeWorkflow` |
| `POST /:id/fast-forward` | `fastForwardWorkflow` (body: `{ data? }`) |
| `POST /:id/trigger` | `triggerEvent` (body: `{ eventName, data? }`) |

Errors map to `400` (validation), `401` (`resolveContext` threw), `404` (unknown run), `409` (illegal transition), `500`.

## Not built yet

Ledgered deliberately, not oversights — each needs a design decision more than
it needs code:

| | Notes |
|---|---|
| Dark-mode **toggle** | The tokens already switch on `prefers-color-scheme`; this is an explicit override control, which needs somewhere to persist the choice |
| Keyboard navigation | Arrow-key row traversal and shortcuts for the action bar |
| Bulk actions | Multi-select plus a confirm step; the adapter has no batch endpoint, so it would be N requests |
| Sortable column headers | The engine paginates by cursor, so sorting has to happen server-side to stay correct across pages |
| Real Trigger event form | Currently a stub. A useful form needs to know a workflow's event names, which the engine doesn't expose |
| Copy / deep-link a run | Shareable URL per run; needs the host app's routing, since the dashboard doesn't own the URL bar |

Also out of scope by design: starting workflows from the UI, metrics, alerting,
and realtime streaming.

---

## License

MIT
