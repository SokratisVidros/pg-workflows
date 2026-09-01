# Workflow runs dashboard — Next.js example

A Next.js App Router app that embeds `<WorkflowRunsDashboard/>` from
[`@pg-workflows/ui`](../../packages/ui) and serves it from a real
`WorkflowEngine`. Used for end-to-end verification of the package.

This is a standalone install, not a workspace member — it depends on the engine
and the UI package by path, so it always exercises your local build.

## Run it

```bash
cp .env.example .env          # point DATABASE_URL at a scratch database
npm install
npm run seed                  # creates runs in every state
npm run dev                   # http://localhost:3000
```

`npm run seed` and `npm run dev` both build the engine and the UI package first
if their `dist/` is missing, so a fresh clone works without extra steps.

> The engine creates its own tables plus an isolated `pg-boss` schema. Point
> `DATABASE_URL` at a database you don't mind it owning — not your app's.

## What's wired up

| Path | What it does |
|------|--------------|
| `app/page.tsx` | Server component rendering `<WorkflowRunsDashboard baseUrl="/workflow-runs" />` |
| `app/workflow-runs/[[...path]]/route.ts` | Optional catch-all adapter, from `createAppRouterHandler` |
| `lib/workflows.ts` | Three workflows covering the completed / failed / waiting states |
| `lib/engine.ts` | Lazily-constructed engine singleton |
| `lib/runs-api.ts` | `createWorkflowRunsApi` + startup gating |
| `scripts/seed.ts` | Seeds runs across every status |

The seeded workflows are chosen so the dashboard has something distinct to show
in each state:

- **`nightly-report`** — three steps, runs to completion
- **`flaky-import`** — throws in `validate-batch` with retries off, so it lands
  in `failed` with a partial timeline and a real error message
- **`order-fulfillment`** — stops at a `step.waitFor` until a
  `payment-confirmed` event arrives. The seed script drives one of these to
  completion (giving a run with a satisfied `waitFor` in its timeline), leaves
  one waiting, and cancels a third

Note that a run blocked on `step.waitFor` reports status **`paused`** — there is
no separate "waiting" status, so those runs *are* the paused ones and calling
`pauseWorkflow` on one throws.

## Two things worth copying

**Nothing is constructed at import time.** `next build` imports every route
module to collect metadata, so building a connection pool — or even reading
`DATABASE_URL` — at module scope would make your build depend on a reachable
database. `getEngine()` and `runsApi.fetch` defer everything to the first
request.

**The catch-all awaits engine startup.** Lifecycle actions can't enqueue a job
until `engine.start()` has resolved, and a route handler has no lifecycle hook
in which to wait for that. `runsApi.fetch` awaits one shared, cached start
promise first — see `lib/runs-api.ts`.

## Security

This demo passes no `resolveContext`, so the adapter is open over **every run**
— appropriate for a local single-tenant demo and nothing else. Anything
multi-tenant must mount these routes behind its own auth and supply
`resolveContext`; see the [Security section](../../packages/ui/README.md#security--multi-tenancy)
of the package README.
