# pg-workflows Dashboard — Design

- **Date:** 2026-08-13
- **Status:** Approved (pending spec review)
- **Branch:** `feat/pg-workflows-ui-dashboard` (based on `feat/pg-workflows-ui`)
- **Package:** `@pg-workflows/ui`

## Context

`feat/pg-workflows-ui` scaffolded `packages/ui` and built the primitives, data layer,
hooks, and leaf/presentational components for a workflow-runs dashboard — with tests —
but nothing is assembled or exported, and there is no server-side data source. The
package's public API (`src/index.ts`) is `export {}`, and the declared `./next` export
points at a `src/next/index.ts` that does not exist.

This design completes the dashboard end-to-end: an HTTP adapter over the existing engine
management API, the UI assembly, a **headless** hook/client surface, an embeddable
component, an `npx` standalone, and a demo app.

### Already built (on `feat/pg-workflows-ui`, with tests)

- Package scaffold, theme tokens, Tailwind preset, `cn` helper
- `lib/`: duration, step-extraction, filters/sorting
- Data layer: `WorkflowRunsClient` interface + `createFetchClient`; `WorkflowRunsProvider` + context
- Hooks: `useWorkflowRuns`, `useWorkflowRun`, `useRunFilters`, `useWorkflowRunsClient` (React Query + polling)
- Leaf components: `StatusBadge`, `LiveIndicator`, `JsonViewer`, `StepTimeline`, `RunDetailHeader`
- `FilterBar` with status / workflowId / date-range / duration / search filters

## Goals

1. Expose the engine's read + lifecycle-action management API over HTTP via a
   **framework-agnostic core**, with adapters covering **Next.js App Router, Next.js Pages
   Router, TanStack Start, and Vite/SPA** front-ends (plus Node/Express and the `npx` standalone).
2. Ship a **headless** surface: every hook, the client, the provider, and the primitives
   are exported so users can build their own UI without the prebuilt dashboard.
3. Assemble an embeddable `<WorkflowRunsDashboard/>` from the existing leaf components.
4. Ship a thin `npx` standalone that reuses the same core + component against `DATABASE_URL`.
5. Provide a Next.js demo app for end-to-end verification.
6. Make the package buildable, exportable, and documented.

## Non-goals / out of scope

- **No engine changes.** `getRuns` already supports bidirectional cursor pagination and
  `resourceId` scoping; all lifecycle actions exist. The workflow-id filter derives its
  options from `getRuns()` results — no new engine method is added.
- No `startWorkflow` from the UI (deferred).
- The adapter does **not** own authentication (the host does). It owns only optional
  per-request scoping (see Security).
- No metrics, alerting, or realtime/streaming (separate future work).

## Decisions (locked)

| # | Decision |
|---|----------|
| API scope | Read + lifecycle actions: `cancel`, `pause`, `resume`, `fast-forward`, `trigger`. No `startWorkflow`. |
| Server shape | Framework-agnostic core (Web `Request`/`Response`) + a Node (`req`/`res`) adapter; thin per-framework wrappers. |
| Framework targets | Next App Router, Next Pages Router, TanStack Start, Vite/SPA, Express/Node, `npx` standalone. |
| DX | Headless hooks/client **and** an embeddable `<WorkflowRunsDashboard/>`; then a thin `npx` CLI over the same core + component. |
| Auth/scoping | Host-owned auth + optional `resolveContext(req) → { resourceId }` hook (default: no scope). |
| Naming | **Run-centric**, matching the engine's noun (`WorkflowRun`, `runId`, `getRun`/`getRuns`) and the existing UI package. Adapter/client action methods use run names that map onto the engine's `*Workflow` methods (see Naming). |
| Engine changes | **None.** Workflow-id filter options come from `getRuns()`. |
| `npx` standalone | Full read + actions, bound to **localhost only**. |
| Demo app | Next.js. |

## Naming & engine alignment

The engine's entity is a **run** (`WorkflowRun`, identified by `runId`, scoped by
`resourceId`, filtered by `workflowId`). Reads are run-named (`getRun`, `getRuns`); the
lifecycle **action methods carry a legacy `*Workflow` suffix** even though they operate on
a `runId`. The UI package already standardized on run-centric names (`WorkflowRunsClient`,
`listRuns`, `getRun`, `useWorkflowRun`). This design stays **run-centric everywhere** and
maps action names onto the engine methods:

| Concept | HTTP | Adapter / client method | Hook | Engine method |
|---------|------|-------------------------|------|---------------|
| List runs | `GET /workflow-runs` | `listRuns(params)` | `useWorkflowRuns` | `getRuns({ resourceId, startingAfter, endingBefore, limit, statuses, workflowId })` |
| Get run | `GET /workflow-runs/:id` | `getRun(id)` | `useWorkflowRun` | `getRun({ runId, resourceId })` |
| Cancel | `POST /workflow-runs/:id/cancel` | `cancelRun(id)` | `useCancelRun` | `cancelWorkflow({ runId, resourceId })` |
| Pause | `POST /workflow-runs/:id/pause` | `pauseRun(id)` | `usePauseRun` | `pauseWorkflow({ runId, resourceId })` |
| Resume | `POST /workflow-runs/:id/resume` | `resumeRun(id)` | `useResumeRun` | `resumeWorkflow({ runId, resourceId })` |
| Fast-forward | `POST /workflow-runs/:id/fast-forward` | `fastForwardRun(id, { data? })` | `useFastForwardRun` | `fastForwardWorkflow({ runId, resourceId, data })` |
| Trigger event | `POST /workflow-runs/:id/trigger` | `triggerEvent(id, { eventName, data? })` | `useTriggerEvent` | `triggerEvent({ runId, resourceId, eventName, data })` |

Conventions: the URL/`id` path param **is** the `runId`; `resourceId` is never taken from
the client — it comes from `resolveContext` on the server. Top-level exported types keep
the `WorkflowRuns*` prefix (`WorkflowRunsClient`, `WorkflowRunsProvider`,
`WorkflowRunsApi`, `WorkflowRunsDashboard`); methods and hooks use `…Run` / `…Runs`.

## Architecture

```
Browser: <WorkflowRunsDashboard/> or your own UI ──> hooks ──> WorkflowRunsClient (createFetchClient)
                                                                        │ HTTP (JSON)
Server:  framework wrapper (thin) ──> WorkflowRunsApi (agnostic core) ──> WorkflowEngine ──> Postgres
```

Four layers, all new code in `packages/ui`:

1. **Engine** — unchanged. Consumed via its existing methods.
2. **Server adapter** (`./server`) — `createWorkflowRunsApi`, framework-agnostic.
3. **Framework wrappers** (`./next`, docs for TanStack Start / Express) — thin shims.
4. **Client + hooks + UI** (`.`, `./client`) — extended client/hooks + headless surface + assembled dashboard.
5. **Delivery** — `index.ts` exports, `npx` CLI (`bin`), demo app.

## Framework support

The core is written against Web-standard `Request`/`Response`; a `toNodeHandler` bridges
to Node `(req, res)`. That combination covers every target:

| Target | Import | Handler flavor |
|--------|--------|----------------|
| Next.js **App Router** | `./next` → `createRouteHandlers(api)` (per-file `route.ts`) | Web `Request`/`Response` |
| Next.js **Pages Router** | `./next` → `createPagesApiHandler(api)` (catch-all `pages/api/workflow-runs/[[...path]].ts`) | Node `req`/`res` |
| **TanStack Start** | `./server` → `api.fetch(request)` inside a server route | Web `Request`/`Response` |
| **Vite / SPA** (client only) | `.` + `./client` — components/hooks/`createFetchClient` pointed at a separately-hosted API | n/a (client) |
| **Express / Node / Bun / Hono / Workers** | `./server` → `toNodeHandler(api.fetch)` (Node/Express) or `api.fetch` (Web) | both |
| **`npx` standalone** | internal — `toNodeHandler` against a local engine | Node `req`/`res` |

Notes:
- **App Router** uses the fixed per-file route tree (below). A catch-all
  `app/workflow-runs/[[...path]]/route.ts` via `api.fetch` is also supported for hosts
  that prefer one file.
- **Pages Router** cannot express the nested tree as ergonomically, so it uses a single
  catch-all API route delegating to `api.fetch` through `toNodeHandler`.
- **Vite/SPA** hosts run no adapter themselves; the client + hooks are pure React (React
  Query) and work anywhere, hitting an API hosted by any of the server targets.

## Components

### 1. Server adapter — `createWorkflowRunsApi` (`packages/ui/src/server/`)

```ts
type WorkflowRunsApiOptions = {
  engine: WorkflowEngine
  basePath?: string                                   // default '/workflow-runs'
  resolveContext?: (req: Request) => MaybePromise<{ resourceId?: string }>
}

type WorkflowRunsApi = {
  listRuns:       (req: Request) => Promise<Response>              // GET  ?starting_after&ending_before&limit&workflow_id&statuses[]
  getRun:         (req: Request, id: string) => Promise<Response>  // GET  /:id
  cancelRun:      (req: Request, id: string) => Promise<Response>  // POST /:id/cancel
  pauseRun:       (req: Request, id: string) => Promise<Response>  // POST /:id/pause
  resumeRun:      (req: Request, id: string) => Promise<Response>  // POST /:id/resume
  fastForwardRun: (req: Request, id: string) => Promise<Response>  // POST /:id/fast-forward   body: { data? }
  triggerEvent:   (req: Request, id: string) => Promise<Response>  // POST /:id/trigger        body: { eventName, data? }
  fetch:          (req: Request) => Promise<Response>              // path+method dispatcher (standalone, TanStack Start, catch-all)
}

function createWorkflowRunsApi(opts: WorkflowRunsApiOptions): WorkflowRunsApi
function toNodeHandler(fetch: (req: Request) => Promise<Response>): (req, res) => void   // Node/Express/Pages bridge
```

- **Purpose:** translate HTTP ⇆ engine calls; single place for validation, error mapping, scoping.
- **Interface:** Web-standard `Request`/`Response`. `fetch` dispatches by method+path for
  non-file-based hosts; `toNodeHandler` bridges to Node `req`/`res`.
- **Behavior per op:** `await resolveContext(req)` → `{ resourceId }` → call the engine
  method (see Naming map) with that `resourceId` → JSON response. Mutations re-read the run
  (`getRun`) and return the updated `WorkflowRun`, so hooks can refresh cache from the response.
- **Depends on:** `WorkflowEngine` (constructor injection), zod for body/query parsing.

### 2. Next.js wrappers (`packages/ui/src/next/`)

**App Router** — `createRouteHandlers(api)` returns `{ list, detail, cancel, pause,
resume, fastForward, trigger }`, each a route handler. Host wiring stays trivial and
matches the fixed tree:

```ts
// app/workflow-runs/[id]/cancel/route.ts
import { handlers } from '@/lib/pgw'
export const POST = handlers.cancel
```

```
workflow-runs/route.ts                     GET  list      → api.listRuns
workflow-runs/[id]/route.ts                GET  one       → api.getRun
workflow-runs/[id]/cancel/route.ts         POST cancel    → api.cancelRun
workflow-runs/[id]/pause/route.ts          POST pause     → api.pauseRun
workflow-runs/[id]/resume/route.ts         POST resume    → api.resumeRun
workflow-runs/[id]/fast-forward/route.ts   POST ff        → api.fastForwardRun
workflow-runs/[id]/trigger/route.ts        POST trigger   → api.triggerEvent
```

**Pages Router** — `createPagesApiHandler(api)` returns a single Node API handler for a
catch-all route:

```ts
// pages/api/workflow-runs/[[...path]].ts
import { pagesHandler } from '@/lib/pgw'
export default pagesHandler
```

### 3. Client + hooks (headless surface)

Extend `WorkflowRunsClient` + `createFetchClient` (both exist) with the run actions from
the Naming map: `cancelRun(id)`, `pauseRun(id)`, `resumeRun(id)`,
`fastForwardRun(id, { data? })`, `triggerEvent(id, { eventName, data? })`. Each returns the
updated `WorkflowRun`.

Add React Query mutation hooks — `useCancelRun`, `usePauseRun`, `useResumeRun`,
`useFastForwardRun`, `useTriggerEvent` — each invalidating `['pgw','run',id]` and
`['pgw','runs']` on success.

**Headless is a first-class mode.** The full surface is exported from `.` so consumers can
build their own UI: `WorkflowRunsProvider`, `useWorkflowRunsClient`, all query + mutation
hooks, `useRunFilters`, the `WorkflowRunsClient` type, `createFetchClient` (also on
`./client`), and every primitive/leaf component. The prebuilt dashboard is one consumer of
this surface, not a privileged one.

### 4. `<WorkflowRunsDashboard/>` — assembly

New components composing the existing leaves (all individually exported):

- **`RunsTable`** — columns: `StatusBadge`, workflowId, short runId, resourceId,
  created/updated, duration. Row click selects a run. Loading / empty / error states.
- **`Pagination`** — prev/next driven by `nextCursor` / `prevCursor` / `hasMore` / `hasPrev`.
- **`RunDetail`** — `RunDetailHeader` + **action bar** (cancel / pause / resume /
  fast-forward / trigger, each enabled per run status) + `StepTimeline` + `JsonViewer`
  (input / output / error). Actions use the mutation hooks.
- **`WorkflowRunsDashboard`** — top-level: `FilterBar` + `RunsTable` + `Pagination` +
  `RunDetail` + `LiveIndicator`. The workflow-id filter's options are the distinct
  `workflowId`s from a separate **unparametrized `listRuns()`** call (`getRuns` with no
  filters) — no dedicated engine method. Holds internal selected-run state with an optional
  `onSelectRun` / controlled `selectedRunId` escape hatch for hosts that route themselves.
  Accepts either a `client` or a `baseUrl`.
- **`index.ts`** — replace `export {}` with the full public surface: provider, context,
  hooks (queries + mutations), client + `createFetchClient`, all components, the
  dashboard, and types.

### 5. `npx` standalone CLI (`packages/ui/bin/`, phase 2)

```
npx @pg-workflows/ui --database-url=postgres://… [--port=3777]
```

- Instantiates `new WorkflowEngine({ connectionString })`, calls `engine.start()`
  (needed so lifecycle actions can enqueue), mounts `createWorkflowRunsApi({ engine })`
  via `toNodeHandler` (no `resolveContext`), and serves a **prebuilt static bundle** of
  `<WorkflowRunsDashboard baseUrl="/workflow-runs"/>`.
- **Binds `127.0.0.1` only.** No auth (localhost trust boundary).
- **Cost:** a Vite build producing the static bundle shipped at `dist/standalone/`.

### 6. Demo app (`examples/dashboard/`)

A Next.js (App Router) app that registers 2–3 example workflows, mounts the route tree via
`createRouteHandlers`, renders `<WorkflowRunsDashboard/>`, and seeds runs (including
paused / failed / waiting states). Standalone install (not a published workspace member).
Used for end-to-end verification and screenshots.

## Data flow

1. `<WorkflowRunsDashboard/>` (or a custom UI) renders `FilterBar`; `useRunFilters` holds filter state.
2. `useWorkflowRuns(params)` → `WorkflowRunsClient.listRuns` → `GET /workflow-runs?…` →
   framework wrapper → `api.listRuns` → `engine.getRuns({ resourceId, … })`.
3. Row click → `useWorkflowRun(id)` → `GET /workflow-runs/:id` → `engine.getRun`.
4. Action button → mutation hook → `POST /workflow-runs/:id/<action>` → `api.<action>` →
   engine method (Naming map) → adapter re-reads run → query invalidation → UI refresh.

## Error handling

Core maps engine errors to HTTP:

| Condition | Status |
|-----------|--------|
| `resolveContext` throws | 401 |
| `WorkflowRunNotFoundError` | 404 |
| Zod validation (query/body) | 400 |
| Illegal transition (e.g. resume a non-paused run) | 409 |
| Unexpected | 500 (no internal detail leaked) |

Client throws on non-2xx; hooks surface `error` to components, which render inline error
states. Mutations show a toast/inline error and leave the run untouched.

## Security

- **AuthN is the host's job.** The framework wrappers are ordinary handlers the host
  protects with its own middleware.
- **Scoping is injectable.** `resolveContext(req)` returns `{ resourceId }` (or throws
  401). Every read and every action passes that `resourceId` to the engine, so a caller
  cannot see or act on another tenant's runs. Default (no hook) = no scope (single-tenant
  / internal use).
- **`npx` standalone** binds localhost only and applies no scope — the trust boundary is
  the local machine.

## Testing

Follow the existing per-file Vitest pattern (PGlite for unit, real Postgres for integration):

- **Core ops** (mock engine): success shape, `resolveContext` scoping, 400/401/404/409 mapping, `fetch` dispatch, `toNodeHandler`.
- **Mutation hooks**: invalidation on success, error propagation.
- **Assembly components**: `RunsTable`, `Pagination`, `RunDetail` (action gating), `WorkflowRunsDashboard`.
- **Next handlers**: App Router route handlers + Pages Router catch-all against a PGlite-backed engine.
- **Demo app**: renders and lists seeded runs.

## Build & packaging

- **Build:** bunup (JS + types) for the library; Vite for the standalone static bundle;
  compiled `styles.css`. Add `build` script to `packages/ui` (currently only
  `check-types` / `test`).
- **`exports`:** `.` (components/hooks/client re-export — client-safe, works in Vite/TanStack/Next),
  `./client` (fetch client + types, no React server deps), `./server`
  (`createWorkflowRunsApi`, `toNodeHandler`), `./next` (`createRouteHandlers`,
  `createPagesApiHandler`), `./tailwind`, `./styles.css`, plus `bin`.
- **Monorepo:** wire root `build` / `test` / `lint` to include the `packages/ui`
  workspace; update the lockfile for new deps.
- **README:** author `packages/ui/README.md` (listed in `files`, currently absent),
  documenting headless usage and each framework target.

## Delivery phases

1. **Server adapter** — `createWorkflowRunsApi` core + `fetch` dispatcher + `toNodeHandler` + error mapping + `resolveContext` + tests.
2. **Framework wrappers** — Next App Router `createRouteHandlers` + Pages Router `createPagesApiHandler`; TanStack Start / Express documented; handler tests.
3. **Client + mutation hooks** — extend client, add hooks + tests; confirm headless exports.
4. **UI assembly** — `RunsTable`, `Pagination`, `RunDetail`, `WorkflowRunsDashboard`, fill `index.ts`.
5. **Demo app** — Next.js example; verify end-to-end.
6. **`npx` standalone** — Vite bundle + CLI, localhost.
7. **Packaging** — build config, exports, root wiring, README.
