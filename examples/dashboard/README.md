# Workflow runs dashboard — Next.js example

A Next.js App Router app that embeds `<WorkflowRunsDashboard/>` from
[`@pg-workflows/ui`](../../packages/ui) and serves it from a real
`WorkflowEngine`. Used for end-to-end verification of the package.

To open the same default dashboard with no Next.js app, see [Try the dashboard](../../packages/ui/README.md#try-the-dashboard).

This is a workspace member (`examples/dashboard`). From the repo root, `bun install`
links the local `pg-workflows` and `@pg-workflows/ui` packages.

## Run it

```bash
bun install                   # from the repo root
cd examples/dashboard
cp .env.example .env          # point DATABASE_URL at a scratch database
bun run seed                  # creates runs in every state
bun run dev                   # http://localhost:3000
```

From the repo root, `bun run dev:ui` is the same dev server.

`next dev` compiles `@pg-workflows/ui` from `packages/ui/src`, so component
edits Fast Refresh without rebuilding the UI package. Seed and dev still build
the engine if `packages/pg-workflows/dist` is missing.

> The engine creates its own tables plus an isolated `pg-boss` schema. Point
> `DATABASE_URL` at a database you don't mind it owning — not your app's.

## What's wired up

| Path | What it does |
|------|--------------|
| `app/page.tsx` | Server component rendering `<WorkflowRunsDashboard baseUrl="/workflow-runs" />` |
| `app/workflow-runs/[[...path]]/route.ts` | Optional catch-all adapter, from `createAppRouterHandler` |
| `lib/workflows.ts` | Four workflows covering the completed / failed / waiting / running states |
| `lib/engine.ts` | Lazily-constructed engine singleton. The route passes `getEngine` to `createAppRouterHandler`, which awaits startup and builds the API. |
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
- **`catalog-reindex`** — a long `step.run` so two seeded runs stay in
  `running` while you browse the dashboard. `waitFor`/`delay` pause; only an
  in-flight `step.run` reports `running`

Note that a run blocked on `step.waitFor` reports status **`paused`** — there is
no separate "waiting" status, so those runs *are* the paused ones and calling
`pauseWorkflow` on one throws.

## Two things worth copying

**Nothing is constructed at import time.** `next build` imports every route
module to collect metadata, so building a connection pool — or even reading
`DATABASE_URL` — at module scope would make your build depend on a reachable
database. The route passes `getEngine` (not `getEngine()`), and
`createAppRouterHandler` calls it when a request arrives.

**The catch-all awaits engine startup.** Lifecycle actions can't enqueue a job
until `engine.start()` has resolved. The handler awaits that once and reuses
the promise. `getEngine` also registers workflow definitions added after the
first start, so a hot reload can pick up a new seed fixture.

## Security

This demo passes no `resolveContext`, so the adapter is open over **every run**
— appropriate for a local single-tenant demo and nothing else. Anything
multi-tenant must mount these routes behind its own auth and supply
`resolveContext`; see the [Security section](../../packages/ui/README.md#security)
of the package README.
