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
management API, the UI assembly, an embeddable component, an `npx` standalone, and a
demo app.

### Already built (on `feat/pg-workflows-ui`, with tests)

- Package scaffold, theme tokens, Tailwind preset, `cn` helper
- `lib/`: duration, step-extraction, filters/sorting
- Data layer: `WorkflowRunsClient` interface + `createFetchClient`; `WorkflowRunsProvider` + context
- Hooks: `useWorkflowRuns`, `useWorkflowRun`, `useRunFilters`, `useWorkflowRunsClient` (React Query + polling)
- Leaf components: `StatusBadge`, `LiveIndicator`, `JsonViewer`, `StepTimeline`, `RunDetailHeader`
- `FilterBar` with status / workflowId / date-range / duration / search filters

## Goals

1. Expose the engine's read + lifecycle-action management API over HTTP via a
   **framework-agnostic core**, with a **Next.js App Router** wrapper matching a fixed route tree.
2. Assemble an embeddable `<WorkflowRunsDashboard/>` from the existing leaf components.
3. Ship a thin `npx` standalone that reuses the same core + component against `DATABASE_URL`.
4. Provide a Next.js demo app for end-to-end verification.
5. Make the package buildable, exportable, and documented.

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
| Server shape | Framework-agnostic core (Web `Request`/`Response`) + thin Next.js wrapper. |
| DX | Embeddable component **first**, then a thin `npx` CLI wrapper over the same core + component. |
| Auth/scoping | Host-owned auth + optional `resolveContext(req) → { resourceId }` hook (default: no scope). |
| Engine changes | **None.** Workflow-id filter options come from `getRuns()`. |
| `npx` standalone | Full read + actions, bound to **localhost only**. |
| Demo app | Next.js. |

## Architecture

```
Browser: <WorkflowRunsDashboard/> ──> React Query hooks ──> createFetchClient(baseUrl)
                                                                  │ HTTP (JSON)
Server:  Next route.ts (thin) ──> createRunsApi (agnostic core) ──> WorkflowEngine ──> Postgres
```

Four layers, all new code in `packages/ui`:

1. **Engine** — unchanged. Consumed via its existing methods.
2. **Server adapter** (`./server`) — `createRunsApi`, framework-agnostic.
3. **Next wrapper** (`./next`) — thin shims exporting route handlers.
4. **Client + UI** (`.`, `./client`) — extended client/hooks + assembled dashboard.
5. **Delivery** — `index.ts` exports, `npx` CLI (`bin`), demo app.

## Components

### 1. Server adapter — `createRunsApi` (`packages/ui/src/server/`)

```ts
type RunsApiOptions = {
  engine: WorkflowEngine
  basePath?: string                                   // default '/workflow-runs'
  resolveContext?: (req: Request) => MaybePromise<{ resourceId?: string }>
}

type RunsApi = {
  listRuns:       (req: Request) => Promise<Response>              // GET  ?starting_after&ending_before&limit&workflow_id&statuses[]
  getRun:         (req: Request, id: string) => Promise<Response>  // GET  /:id
  cancelRun:      (req: Request, id: string) => Promise<Response>  // POST /:id/cancel
  pauseRun:       (req: Request, id: string) => Promise<Response>  // POST /:id/pause
  resumeRun:      (req: Request, id: string) => Promise<Response>  // POST /:id/resume
  fastForwardRun: (req: Request, id: string) => Promise<Response>  // POST /:id/fast-forward   body: { stepId, eventName?, data? }
  triggerEvent:   (req: Request, id: string) => Promise<Response>  // POST /:id/trigger        body: { eventName, data? }
  fetch:          (req: Request) => Promise<Response>              // path+method dispatcher (standalone / non-file-based frameworks)
}

function createRunsApi(opts: RunsApiOptions): RunsApi
```

- **Purpose:** translate HTTP ⇆ engine calls; single place for validation, error mapping, scoping.
- **Interface:** Web-standard `Request`/`Response` — works in Next App Router, Hono, Bun, Deno, Cloudflare Workers. An Express/Node adapter (`toNodeHandler(api.fetch)`) is a thin extra.
- **Behavior per op:** `await resolveContext(req)` → `{ resourceId }` → call the engine method with that `resourceId` → JSON response.
- **Depends on:** `WorkflowEngine` (constructor injection), zod for body/query parsing.

### 2. Next.js wrapper (`packages/ui/src/next/`)

Exports `createRouteHandlers(api)` returning `{ list, detail, cancel, pause, resume, fastForward, trigger }`, each a Next route handler. Host wiring stays trivial:

```ts
// app/workflow-runs/[id]/cancel/route.ts
import { handlers } from '@/lib/pgw'
export const POST = handlers.cancel
```

Route tree (fixed):

```
workflow-runs/route.ts                     GET  list      → api.listRuns
workflow-runs/[id]/route.ts                GET  one       → api.getRun
workflow-runs/[id]/cancel/route.ts         POST cancel    → api.cancelRun
workflow-runs/[id]/pause/route.ts          POST pause     → api.pauseRun
workflow-runs/[id]/resume/route.ts         POST resume    → api.resumeRun
workflow-runs/[id]/fast-forward/route.ts   POST ff        → api.fastForwardRun
workflow-runs/[id]/trigger/route.ts        POST trigger   → api.triggerEvent
```

### 3. Client + mutation hooks

Extend `WorkflowRunsClient` + `createFetchClient` (both exist) with:
`cancelRun(id)`, `pauseRun(id)`, `resumeRun(id)`, `fastForwardRun(id, body)`, `triggerEvent(id, body)`.

Add React Query mutation hooks: `useCancelRun`, `usePauseRun`, `useResumeRun`,
`useFastForwardRun`, `useTriggerEvent` — each invalidates `['pgw','run',id]` and
`['pgw','runs']` on success so the table + detail refresh.

### 4. `<WorkflowRunsDashboard/>` — assembly

New components composing the existing leaves:

- **`RunsTable`** — columns: `StatusBadge`, workflowId, short runId, resourceId,
  created/updated, duration. Row click selects a run. Loading / empty / error states.
- **`Pagination`** — prev/next driven by `nextCursor` / `prevCursor` / `hasMore` / `hasPrev`.
- **`RunDetail`** — `RunDetailHeader` + **action bar** (cancel / pause / resume /
  fast-forward / trigger, each enabled per run status) + `StepTimeline` + `JsonViewer`
  (input / output / error). Actions use the mutation hooks.
- **`WorkflowRunsDashboard`** — top-level: `FilterBar` + `RunsTable` + `Pagination` +
  `RunDetail` + `LiveIndicator`. The workflow-id filter's options are the distinct
  `workflowId`s from a separate **unparametrized `getRuns()`** call (`listRuns` with no
  filters) — no dedicated engine method. Holds internal
  selected-run state with an optional `onSelectRun` / controlled `selectedRunId` escape
  hatch for hosts that route themselves. Accepts either a `client` or a `baseUrl`.
- **`index.ts`** — replace `export {}` with the full public surface: provider, context,
  hooks (queries + mutations), client + `createFetchClient`, all components, the
  dashboard, and types.

### 5. `npx` standalone CLI (`packages/ui/bin/`, phase 2)

```
npx @pg-workflows/ui --database-url=postgres://… [--port=3777]
```

- Instantiates `new WorkflowEngine({ connectionString })`, calls `engine.start()`
  (needed so lifecycle actions can enqueue), mounts `createRunsApi({ engine })` (no
  `resolveContext`), and serves a **prebuilt static bundle** of `<WorkflowRunsDashboard baseUrl="/workflow-runs"/>`.
- **Binds `127.0.0.1` only.** No auth (localhost trust boundary).
- **Cost:** a Vite build producing the static bundle shipped at `dist/standalone/`.

### 6. Demo app (`examples/dashboard/`)

A Next.js app that registers 2–3 example workflows, mounts the route tree via
`createRouteHandlers`, renders `<WorkflowRunsDashboard/>`, and seeds runs (including
paused / failed / waiting states). Standalone install (not a published workspace member).
Used for end-to-end verification and screenshots.

## Data flow

1. `<WorkflowRunsDashboard/>` renders `FilterBar`; `useRunFilters` holds filter state.
2. `useWorkflowRuns(params)` → `createFetchClient.listRuns` → `GET /workflow-runs?…` →
   Next handler → `api.listRuns` → `engine.getRuns({ resourceId, … })`.
3. Row click → `useWorkflowRun(id)` → `GET /workflow-runs/:id` → `engine.getRun`.
4. Action button → mutation hook → `POST /workflow-runs/:id/<action>` → `api.<action>` →
   engine method → query invalidation → table/detail refresh.

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

- **AuthN is the host's job.** The Next routes are ordinary route handlers the host
  protects with its own middleware.
- **Scoping is injectable.** `resolveContext(req)` returns `{ resourceId }` (or throws
  401). Every read and every action passes that `resourceId` to the engine, so a caller
  cannot see or act on another tenant's runs. Default (no hook) = no scope (single-tenant
  / internal use).
- **`npx` standalone** binds localhost only and applies no scope — the trust boundary is
  the local machine.

## Testing

Follow the existing per-file Vitest pattern (PGlite for unit, real Postgres for integration):

- **Core ops** (mock engine): success shape, `resolveContext` scoping, 400/401/404/409 mapping.
- **Mutation hooks**: invalidation on success, error propagation.
- **Assembly components**: `RunsTable`, `Pagination`, `RunDetail` (action gating), `WorkflowRunsDashboard`.
- **Next handlers**: against a PGlite-backed engine, exercising the full route tree.
- **Demo app**: renders and lists seeded runs.

## Build & packaging

- **Build:** bunup (JS + types) for the library; Vite for the standalone static bundle;
  compiled `styles.css`. Add `build` script to `packages/ui` (currently only
  `check-types` / `test`).
- **`exports`:** `.` (components/hooks), `./client`, `./server`, `./next`, `./tailwind`,
  `./styles.css`, plus `bin`.
- **Monorepo:** wire root `build` / `test` / `lint` to include the `packages/ui`
  workspace; update the lockfile for new deps.
- **README:** author `packages/ui/README.md` (listed in `files`, currently absent).

## Delivery phases

1. **Server adapter** — `createRunsApi` core + error mapping + `resolveContext` + tests.
2. **Next wrapper** — `createRouteHandlers` + the route tree + handler tests.
3. **Client + mutation hooks** — extend client, add hooks + tests.
4. **UI assembly** — `RunsTable`, `Pagination`, `RunDetail`, `WorkflowRunsDashboard`, fill `index.ts`.
5. **Demo app** — Next.js example; verify end-to-end.
6. **`npx` standalone** — Vite bundle + CLI, localhost.
7. **Packaging** — build config, exports, root wiring, README.
