# @pg-workflows/ui

React dashboard and HTTP adapters for [pg-workflows](https://github.com/SokratisVidros/pg-workflows) — browse, monitor, and manage workflow runs, or build your own UI on the headless hooks. It talks to your `WorkflowEngine` through a small, framework-agnostic HTTP layer, so the browser never touches your database.

This is a **separate package** from `pg-workflows`. Install it only in apps that render UI. Workers and API services that just run the engine do not need it.

This guide covers embedding the dashboard in an app, composing your own UI from the hooks and components, styling that UI, and opening the default dashboard with `npx` against a local Postgres.

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
| `@pg-workflows/ui/server` | `createWorkflowRunsApi`, `toFetchHandler`, `toNodeHandler` — Fetch handler + Node `(req, res)` converter | server only |
| `@pg-workflows/ui/next` | `createAppRouterHandler` (App Router catch-all), `createPagesApiHandler` (Pages Router), `createRouteHandlers` (optional per-file App Router) | server only |
| `@pg-workflows/ui/tailwind` | Tailwind preset exposing the `pgw-*` color tokens | build |
| `@pg-workflows/ui/styles.css` | CSS variables (light/dark) + base styles | client |
| `pg-workflows-ui` (bin) | Standalone localhost dashboard — see [Variant 3](#variant-3--run-the-default-dashboard-with-npx) | CLI |

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

Dark mode follows `prefers-color-scheme` on the `--pgw-*` variables. To recolor or restyle components, see [Style them to your liking](#style-them-to-your-liking).

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
- `className`, `style`, and `render` — Base UI style hooks. `className` and `style` may be a value or a function of the dashboard state (`{ selected }`). `render` replaces the root element.

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

One optional catch-all. `api.fetch` already dispatches on method + path, so you do not need a `route.ts` per endpoint:

```ts
// app/workflow-runs/[[...path]]/route.ts
import { createAppRouterHandler } from '@pg-workflows/ui/next'
import { runsApi } from '@/lib/runs-api'

export const { GET, POST } = createAppRouterHandler(runsApi)
```

Use `[[...path]]` (optional) so both `GET /workflow-runs` (list) and `POST /workflow-runs/:id/cancel` match. Point the dashboard at the same prefix: `<WorkflowRunsDashboard baseUrl="/workflow-runs" />`. If you mount under `/api/workflow-runs`, create the api with `basePath: '/api/workflow-runs'` and pass that as `baseUrl`.

> A complete working version of this setup — catch-all route, engine singleton, and a seed script covering every run state — lives in [`examples/dashboard`](../../examples/dashboard).

If you need a file per endpoint (for example to wrap mutations in extra auth), `createRouteHandlers(api)` still returns one named export per route (`const h = createRouteHandlers(runsApi)`). Every export is `api.fetch` — Next provides the full URL, so routing is not reimplemented:

| File | Export |
|------|--------|
| `app/workflow-runs/route.ts` | `export const GET = h.list` |
| `app/workflow-runs/[id]/route.ts` | `export const GET = h.detail` |
| `app/workflow-runs/[id]/cancel/route.ts` | `export const POST = h.cancel` |
| `app/workflow-runs/[id]/pause/route.ts` | `export const POST = h.pause` |
| `app/workflow-runs/[id]/resume/route.ts` | `export const POST = h.resume` |
| `app/workflow-runs/[id]/fast-forward/route.ts` | `export const POST = h.fastForward` |
| `app/workflow-runs/[id]/trigger/route.ts` | `export const POST = h.trigger` |

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

Any Web-standard server can call `api.fetch(request)` directly (or `toFetchHandler(runsApi)` if you already have a wrapper):

```ts
// e.g. a TanStack Start server route or a Hono handler
import { runsApi } from '@/lib/runs-api'
export const handler = (request: Request) => runsApi.fetch(request)
```

### Express / Node

Bridge the Web handler to Node with `toNodeHandler` (Express, Fastify `req.raw`/`reply.raw`, Nest, raw `node:http`). Pass the api or `api.fetch`:

```ts
import express from 'express'
import { toNodeHandler } from '@pg-workflows/ui/server'
import { runsApi } from './runs-api'

const app = express()
// create the api with basePath: '/workflow-runs' — originalUrl keeps the mount prefix
app.use('/workflow-runs', toNodeHandler(runsApi))
```

### Vite / SPA (no server of your own)

The client + hooks are pure React — host the dashboard in a Vite SPA and point it at an API served by any of the targets above (e.g. a separate Node/Hono service): `<WorkflowRunsDashboard baseUrl="https://api.example.com/workflow-runs" />`.

---

## Variant 3 — Run the default dashboard with `npx`

Use this when Postgres and a `pg-workflows` process are already running, and you want the default dashboard without adding React to that app.

The CLI starts its own engine against the **same database**, serves the prebuilt dashboard, and mounts the run API at `/workflow-runs`. It does not register workflow definitions, and it does not execute step handlers. Cancel, pause, resume, fast-forward, and trigger enqueue work for the process that owns the definitions.

### 1. Local Postgres

Any local Postgres works. For example:

```bash
createdb pgworkflows
```

Point both processes at that database. The snippets below use `postgres://localhost:5432/pgworkflows`. Change the user, password, host, and database name to match yours.

### 2. Run pg-workflows

In the app that defines your workflows, start the engine and leave it running:

```ts
import { WorkflowEngine } from 'pg-workflows'
import { sendWelcome } from './workflows'

const engine = new WorkflowEngine({
  connectionString: 'postgres://localhost:5432/pgworkflows',
  workflows: [sendWelcome],
})
await engine.start()
```

Start a run the way you normally do (`engine.startWorkflow(...)`). The dashboard only shows runs that exist in this database. Defining workflows is covered in the [pg-workflows quick start](../../README.md#quick-start).

### 3. Open the dashboard

From another terminal:

```bash
npx @pg-workflows/ui --database-url=postgres://localhost:5432/pgworkflows
```

Then open <http://127.0.0.1:3777>.

`DATABASE_URL` works in place of `--database-url`. `--port` changes the port (default `3777`). `--help` prints the flags.

If the command cannot load `pg-workflows`, install the engine and its `pg` peer in the current directory, then run the command again from there:

```bash
npm install pg-workflows pg
npx @pg-workflows/ui --database-url=postgres://localhost:5432/pgworkflows
```

> **Binds `127.0.0.1` only, with no authentication and no `resolveContext`.** Every run in that database is readable and mutable by anyone who can reach the port. Localhost is the trust boundary. Do not put it behind a tunnel or a reverse proxy.

---

## Variant 4 — Hooks and components

The dashboard's regions are exported. Provide a client with `WorkflowRunsProvider`, then call the hooks and render the components yourself. Every hook below must run under that provider.

```tsx
'use client'
import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkflowRunsProvider, createFetchClient } from '@pg-workflows/ui'

const qc = new QueryClient()
const client = createFetchClient({ baseUrl: '/workflow-runs' })

export function App() {
  const [live, setLive] = useState(true)
  return (
    <QueryClientProvider client={qc}>
      <WorkflowRunsProvider client={client} pollIntervalMs={live ? 5000 : 0}>
        <MyRunsView live={live} onToggleLive={() => setLive((value) => !value)} />
      </WorkflowRunsProvider>
    </QueryClientProvider>
  )
}
```

`pollIntervalMs` is the live-refresh interval for every query under the provider. `0` turns polling off. The default is `5000`.

### Compose a runs view

This is the same wiring `<WorkflowRunsDashboard/>` uses. Status and workflow id go to the server. Search, date, duration, and sort apply to the current page, because the engine paginates by cursor.

```tsx
import { useMemo, useState } from 'react'
import {
  FilterBar,
  LiveToggle,
  Pagination,
  RunDetail,
  RunsTable,
  StatusSummary,
  applyClientFilters,
  sortRuns,
  useRunFilters,
  useWorkflowRunStats,
  useWorkflowRuns,
} from '@pg-workflows/ui'

function MyRunsView({ live, onToggleLive }: { live: boolean; onToggleLive: () => void }) {
  const { filters, setFilters, clearFilters, hasActiveFilters, serverParams } = useRunFilters()
  const runs = useWorkflowRuns(serverParams)
  const stats = useWorkflowRunStats({ workflowId: filters.workflowId })
  const [selected, setSelected] = useState<string | null>(null)

  const items = runs.data?.items ?? []
  const workflowIds = useMemo(
    () => [...new Set(items.map((run) => run.workflowId))].sort(),
    [items],
  )
  const rows = useMemo(() => {
    const filtered = applyClientFilters(items, {
      datePreset: filters.datePreset,
      durationPreset: filters.durationPreset,
      search: filters.search,
    })
    return sortRuns(filtered, filters.sort, filters.dir)
  }, [items, filters])

  if (selected) {
    return (
      <div className="pgw-root">
        <RunDetail runId={selected} onBack={() => setSelected(null)} />
      </div>
    )
  }

  return (
    <div className="pgw-root flex flex-col gap-5">
      <LiveToggle isLive={live} isFetching={runs.isFetching} onToggle={onToggleLive} />
      <StatusSummary
        counts={stats.data ?? {}}
        onSelectStatus={(status) =>
          setFilters({ statuses: [status], startingAfter: undefined, endingBefore: undefined })
        }
      />
      <FilterBar
        filters={filters}
        hasActiveFilters={hasActiveFilters}
        workflowIds={workflowIds}
        onFiltersChange={(partial) =>
          setFilters({ ...partial, startingAfter: undefined, endingBefore: undefined })
        }
        onClear={clearFilters}
      />
      <RunsTable runs={rows} onSelectRun={setSelected} isLoading={runs.isLoading} />
      <Pagination
        hasPrev={!!runs.data?.hasPrev}
        hasNext={!!runs.data?.hasMore}
        isFetching={runs.isFetching}
        onPrev={() =>
          setFilters({
            endingBefore: runs.data?.prevCursor ?? undefined,
            startingAfter: undefined,
          })
        }
        onNext={() =>
          setFilters({
            startingAfter: runs.data?.nextCursor ?? undefined,
            endingBefore: undefined,
          })
        }
      />
    </div>
  )
}
```

Clear `startingAfter` and `endingBefore` when a filter changes. Otherwise the next request stays on a cursor from the previous filter.

`RunDetail` loads the run and calls the lifecycle actions itself. To fire an action from your own control, use `useRunActions()`:

```tsx
const { cancel, pause, resume, fastForward, trigger } = useRunActions()

cancel.mutate({ id: runId })
pause.mutate({ id: runId })
resume.mutate({ id: runId })
fastForward.mutate({ id: runId, data: { skipped: true } })
trigger.mutate({ id: runId, eventName: 'payment-confirmed', data: { ok: true } })
```

### Hooks

#### `useRunFilters(initial?)`

Filter state for the list. `initial` is merged over the defaults (`limit: 20`, `sort: 'createdAt'`, `dir: 'desc'`).

| Field | Role |
|-------|------|
| `filters` | Full filter object |
| `serverParams` | `{ limit, startingAfter, endingBefore, statuses, workflowId }` — pass this to `useWorkflowRuns` |
| `setFilters(partial)` | Merge a partial update |
| `replaceFilters(next)` | Replace the whole object |
| `clearFilters()` | Reset to the defaults |
| `toggleSort(key)` | Sort by `id`, `workflowId`, `createdAt`, `status`, or `duration`. Calling it again on the same key flips `asc` / `desc` |
| `hasActiveFilters` | True when status, workflow id, date, duration, or search is set |

`search`, `datePreset`, `durationPreset`, `sort`, and `dir` stay on the client. `applyClientFilters` matches run id, workflow id, and resource id. `sortRuns` orders the current page. `DATE_PRESETS` and `DURATION_PRESETS` are the option lists `FilterBar` already renders.

#### `useWorkflowRuns(params)`

List query. `params` is `serverParams` from `useRunFilters` (`limit` is required). Returns a React Query result whose `data` is `{ items, nextCursor, prevCursor, hasMore, hasPrev }`. Refetches while `pollIntervalMs > 0`, and keeps the previous page on screen while the next request is in flight.

#### `useWorkflowRun(id)`

One run. The query stays disabled when `id` is empty. Polling stops once the status is terminal (`completed`, `failed`, or `cancelled`). `RunDetail` calls this for you.

#### `useWorkflowRunStats(params?)`

Counts keyed by status: `pending`, `running`, `paused`, `completed`, `failed`, `cancelled`. `params` is `{ workflowId? }`. Pass `data` to `StatusSummary` as `counts`. Polls on the same interval as the list.

#### `useRunActions()`

`{ cancel, pause, resume, fastForward, trigger }`. Each is its own React Query mutation, so `isPending` is per action. On success, the run query and the runs list are invalidated.

| Action | Variables |
|--------|-----------|
| `cancel`, `pause`, `resume` | `{ id }` |
| `fastForward` | `{ id, data? }` |
| `trigger` | `{ id, eventName, data? }` |

#### `useWorkflowRunsClient()`

`{ client, pollIntervalMs }` from the provider. Throws when called outside `WorkflowRunsProvider`.

### Components

Each component also takes `className`, `style`, and `render`. See [Style them to your liking](#style-them-to-your-liking).

| Component | You pass | It renders |
|-----------|----------|------------|
| `WorkflowRunsDashboard` | `baseUrl` or `client` | The full list and detail view. Creates its own React Query client and provider. Other props are under [Variant 1](#variant-1--drop-in-dashboard). |
| `RunsTable` | `runs`, `onSelectRun` | The runs table. `selectedRunId` highlights a row. While `runs` is empty, `isLoading` shows "Loading…" instead of "No runs". |
| `RunDetail` | `runId` | Step timeline, input and output, and the lifecycle actions. `onBack` is the back control. |
| `FilterBar` | `filters`, `hasActiveFilters`, `workflowIds`, `onFiltersChange`, `onClear` | Search, plus status, workflow, date, and duration filters. |
| `StatusSummary` | `counts` | One button per status whose count is above zero. Renders nothing when every count is `0`. `onSelectStatus` fires on click. `trailing` is placed after the stats. |
| `StatusBadge` | `status` | A status label. |
| `Pagination` | `hasPrev`, `hasNext`, `onPrev`, `onNext` | Previous and next. `isFetching` disables both buttons. |
| `LiveToggle` | `isLive`, `isFetching`, `onToggle` | A Live / Paused switch. You own `isLive` and pass `pollIntervalMs={isLive ? 5000 : 0}` to the provider. |

Helpers on the main entry: `applyClientFilters`, `sortRuns`, `formatDuration`, `timeAgo`, `computeDurationMs`, `isTerminalStatus`.

### Without React

`createFetchClient({ baseUrl })` from `@pg-workflows/ui/client` talks to the same HTTP API: `listRuns`, `getRun`, `getStats`, `cancelRun`, `pauseRun`, `resumeRun`, `fastForwardRun`, `triggerEvent`.

---

## Style them to your liking

The components ship with a default look: square corners, ink borders, and status color as the only chroma. Three ways to change it, from the smallest edit to your own markup.

### 1. Recolor with CSS variables

Import `@pg-workflows/ui/styles.css`, then override any `--pgw-*` token on `:root` or a closer scope. Borders, radius, type, and focus use the same tokens as the status hues.

```css
:root {
  --pgw-accent: #6d28d9;
  --pgw-accent-fg: #fff;
  --pgw-border: #e5e5e5;
  --pgw-radius: 0.5rem;
  --pgw-font: "IBM Plex Sans", sans-serif;
  --pgw-focus: #6d28d9;
  --pgw-status-running: #2563eb;
  /* also: --pgw-bg, --pgw-fg, --pgw-card, --pgw-muted, --pgw-muted-fg,
     --pgw-hover, --pgw-active, --pgw-disabled, --pgw-shadow, --pgw-on-status,
     --pgw-status-completed, --pgw-status-failed, --pgw-status-paused,
     --pgw-status-cancelled, --pgw-status-pending */
}
```

A `prefers-color-scheme: dark` block ships its own defaults, so dark mode follows the OS. There is no toggle yet.

### 2. Restyle one component

Every exported component accepts Base UI style hooks:

- `className` — a string, or `(state) => string`.
- `style` — a style object, or `(state) => style object`.
- `render` — an element, or `(props, state) => element`, that replaces the root tag.

The same state is written onto the root as `data-*` attributes, so a stylesheet can target it without a function. `StatusBadge` exposes `data-status`. `LiveToggle` exposes `data-pressed` while live and `data-fetching` while a request is in flight.

```tsx
<StatusBadge
  status={run.status}
  className={(state) => (state.status === 'failed' ? 'ring-2 ring-red-600' : undefined)}
/>

<RunsTable
  runs={rows}
  onSelectRun={setSelected}
  className={(state) => (state.empty ? 'opacity-60' : undefined)}
/>
```

```css
.pgw-badge[data-status='failed'] {
  color: #b91c1c;
}

.pgw-live[data-pressed] {
  border-color: var(--pgw-status-running);
}
```

State passed to `className` / `style`:

| Component | State |
|-----------|--------|
| `StatusBadge` | `{ status }` |
| `RunsTable` | `{ empty, loading }` |
| `RunDetail` | `{ phase, status? }` — `phase` is `'loading'`, `'error'`, or `'ready'` |
| `FilterBar` | `{ active }` |
| `StatusSummary` | `{ empty }` — the element is omitted when there is nothing to show |
| `Pagination` | `{ hasPrev, hasNext, fetching }` |
| `WorkflowRunsDashboard` | `{ selected }` |
| `LiveToggle` | Base UI toggle state (`pressed`, `disabled`), plus the `data-fetching` attribute |

`StatusSummary` also takes a `stat` prop so you can restyle each count button. `className`, `style`, and `render` there receive that button's state:

```tsx
<StatusSummary counts={counts} stat={{ className: 'uppercase tracking-wide' }} />
```

On `LiveToggle`, set `nativeButton={false}` when `render` is not a `<button>`.

### 3. Use the tokens in your own markup

`@pg-workflows/ui/tailwind` exposes the tokens as utilities: `bg-pgw-bg`, `text-pgw-fg`, `border-pgw-border`, `text-pgw-status-running`, `shadow-pgw`, `font-pgw`.

```tsx
<span className="bg-pgw-status-running px-2 text-pgw-on-status">running</span>
```

Add `pgw-root` to the page when you compose the pieces yourself. `<WorkflowRunsDashboard/>` already applies it. It sets the background, foreground, and font.

Stable classes — `.pgw-button`, `.pgw-badge`, `.pgw-input`, `.pgw-popup`, `.pgw-filters`, `.pgw-stat`, `.pgw-live` — live in `@layer components`. Your utilities and unlayered CSS override them.

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
| `GET /stats` | `getStats` (query: `workflow_id`) |
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

## Why a separate package

`pg-workflows` is a Node/Postgres engine. Its peers are `pg`, not React. Putting the dashboard on `pg-workflows/ui` would make every worker install Radix and see a React peer. Keep the engine in workers; add `@pg-workflows/ui` only where you render a UI.

---

## License

MIT
