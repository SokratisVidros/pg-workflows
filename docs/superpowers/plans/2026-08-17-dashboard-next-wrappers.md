# Dashboard Next.js Wrappers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add thin Next.js wrappers (`createRouteHandlers` for App Router, `createPagesApiHandler` for Pages Router) over the existing framework-agnostic `WorkflowRunsApi`, exported from `@pg-workflows/ui/next`.

**Architecture:** `createRouteHandlers(api)` returns named App Router route handlers, each delegating to the matching `api` op and resolving the dynamic `[id]` param (supporting both Next 14 sync `params` and Next 15 `Promise` params). `createPagesApiHandler(api)` returns a single Node API handler = `toNodeHandler(api.fetch)` for a catch-all Pages route. Both use **pure structural typing** — no `next` import — so the package stays dependency-free and Next-version-agnostic.

**Tech Stack:** TypeScript (ESM), Vitest (jsdom, globals), Web `Request`/`Response`, `node:http` + `node:stream` types. Consumes the already-built `WorkflowRunsApi` (`../server/api`) and `toNodeHandler` (`../server/node`).

## Global Constraints

- **Package:** all code under `packages/ui/`. Branch `feat/pg-workflows-ui-dashboard`.
- **Style (Biome, enforced):** single quotes, semicolons always, trailing commas `all`, 2-space indent, 100 line width, `organizeImports`. Run `npx biome check --write` on new files before committing.
- **`tsc --noEmit -p .` must be clean** (package sets `noUncheckedIndexedAccess: true`).
- **No `next` dependency.** Do NOT `import` anything from `next`. Type the wrappers structurally (Web `Request`/`Response`, `node:http` `IncomingMessage`/`ServerResponse`). This keeps `next` optional for consumers and avoids coupling to a specific Next major.
- **No engine changes.** Consume `pg-workflows` as published.
- **Naming:** run-centric; the App Router `[id]` param **is** the `runId`.
- **The `./next` export already exists** in `packages/ui/package.json` (points to `./src/server/../next/index.ts` → `./src/next/index.ts`); this plan only creates that file. Verify the entry resolves; do not duplicate it.
- **Consumed interfaces (verbatim, already built):**
  - `type WorkflowRunsApi = { listRuns(req): Promise<Response>; getRun(req,id): Promise<Response>; cancelRun(req,id); pauseRun(req,id); resumeRun(req,id); fastForwardRun(req,id); triggerEvent(req,id); fetch(req): Promise<Response> }` from `../server/api`.
  - `toNodeHandler(fetchHandler: (req: Request) => Promise<Response>): (req: IncomingMessage, res: ServerResponse) => Promise<void>` from `../server/node`.
- **Run tests from `packages/ui`:** `cd packages/ui && npx vitest run <file>`.

---

## File Structure

- `packages/ui/src/next/index.ts` — `createRouteHandlers`, `createPagesApiHandler`, and the `RouteContext`/`RouteHandlers` types.
- `packages/ui/src/next/index.test.ts` — tests for both wrappers.

`packages/ui/package.json` already declares `"./next"` → `./src/next/index.ts`; no edit needed (Task verifies it).

---

### Task 1: Next.js wrappers (`next/index.ts`)

**Files:**
- Create: `packages/ui/src/next/index.ts`
- Test: `packages/ui/src/next/index.test.ts`

**Interfaces:**
- Consumes: `WorkflowRunsApi` (`../server/api`), `createWorkflowRunsApi` (`../server/api`, test only), `toNodeHandler` (`../server/node`, indirectly).
- Produces:
  - `type RouteContext = { params: { id: string } | Promise<{ id: string }> }`
  - `type RouteHandlers = { list; detail; cancel; pause; resume; fastForward; trigger }` where `list: (req: Request) => Promise<Response>` and every other member is `(req: Request, ctx: RouteContext) => Promise<Response>`
  - `createRouteHandlers(api: WorkflowRunsApi): RouteHandlers`
  - `createPagesApiHandler(api: WorkflowRunsApi): (req: IncomingMessage, res: ServerResponse) => Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui/src/next/index.test.ts
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createWorkflowRunsApi } from '../server/api';
import { createPagesApiHandler, createRouteHandlers } from './index';

function mockApi() {
  return {
    listRuns: vi.fn().mockResolvedValue(new Response('list')),
    getRun: vi.fn().mockResolvedValue(new Response('get')),
    cancelRun: vi.fn().mockResolvedValue(new Response('cancel')),
    pauseRun: vi.fn().mockResolvedValue(new Response('pause')),
    resumeRun: vi.fn().mockResolvedValue(new Response('resume')),
    fastForwardRun: vi.fn().mockResolvedValue(new Response('ff')),
    triggerEvent: vi.fn().mockResolvedValue(new Response('trigger')),
    fetch: vi.fn().mockResolvedValue(new Response('fetch')),
  };
}

describe('createRouteHandlers (App Router)', () => {
  it('list delegates to api.listRuns', async () => {
    const api = mockApi();
    const req = new Request('http://x/workflow-runs');
    await createRouteHandlers(api as never).list(req);
    expect(api.listRuns).toHaveBeenCalledWith(req);
  });

  it('detail resolves a SYNC params object (Next 14) and calls getRun with the id', async () => {
    const api = mockApi();
    const req = new Request('http://x/workflow-runs/run_1');
    await createRouteHandlers(api as never).detail(req, { params: { id: 'run_1' } });
    expect(api.getRun).toHaveBeenCalledWith(req, 'run_1');
  });

  it('detail resolves an ASYNC params promise (Next 15) and calls getRun with the id', async () => {
    const api = mockApi();
    const req = new Request('http://x/workflow-runs/run_2');
    await createRouteHandlers(api as never).detail(req, { params: Promise.resolve({ id: 'run_2' }) });
    expect(api.getRun).toHaveBeenCalledWith(req, 'run_2');
  });

  it('each action handler maps to the matching api op with the resolved id', async () => {
    const api = mockApi();
    const handlers = createRouteHandlers(api as never);
    const req = new Request('http://x', { method: 'POST' });
    await handlers.cancel(req, { params: { id: 'r' } });
    await handlers.pause(req, { params: { id: 'r' } });
    await handlers.resume(req, { params: { id: 'r' } });
    await handlers.fastForward(req, { params: { id: 'r' } });
    await handlers.trigger(req, { params: { id: 'r' } });
    expect(api.cancelRun).toHaveBeenCalledWith(req, 'r');
    expect(api.pauseRun).toHaveBeenCalledWith(req, 'r');
    expect(api.resumeRun).toHaveBeenCalledWith(req, 'r');
    expect(api.fastForwardRun).toHaveBeenCalledWith(req, 'r');
    expect(api.triggerEvent).toHaveBeenCalledWith(req, 'r');
  });
});

function fakeReq(method: string, url: string, body?: string) {
  const stream = Readable.from(body ? [Buffer.from(body)] : []) as unknown as {
    method: string;
    url: string;
    headers: Record<string, string>;
  };
  stream.method = method;
  stream.url = url;
  stream.headers = { host: 'localhost' };
  return stream;
}

function fakeRes() {
  return {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
    },
    end(chunk?: Buffer | string) {
      this.body = chunk ? chunk.toString() : '';
    },
  };
}

describe('createPagesApiHandler (Pages Router)', () => {
  it('bridges a Node request through api.fetch to the engine, honoring basePath', async () => {
    const engine = {
      getRuns: vi
        .fn()
        .mockResolvedValue({ items: [], nextCursor: null, prevCursor: null, hasMore: false, hasPrev: false }),
      getRun: vi.fn(),
      pauseWorkflow: vi.fn(),
      resumeWorkflow: vi.fn(),
      cancelWorkflow: vi.fn(),
      fastForwardWorkflow: vi.fn(),
      triggerEvent: vi.fn(),
    };
    const api = createWorkflowRunsApi({ engine: engine as never, basePath: '/api/workflow-runs' });
    const handler = createPagesApiHandler(api);
    const res = fakeRes();
    await handler(fakeReq('GET', '/api/workflow-runs?limit=5') as never, res as never);
    expect(res.statusCode).toBe(200);
    expect(engine.getRuns).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run src/next/index.test.ts`
Expected: FAIL — cannot find module `./index`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/ui/src/next/index.ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WorkflowRunsApi } from '../server/api';
import { toNodeHandler } from '../server/node';

/**
 * App Router route context. `params` may be a plain object (Next 14) or a
 * Promise (Next 15+); both are supported.
 */
export type RouteContext = { params: { id: string } | Promise<{ id: string }> };

async function routeId(ctx: RouteContext): Promise<string> {
  return (await ctx.params).id;
}

export type RouteHandlers = {
  list: (req: Request) => Promise<Response>;
  detail: (req: Request, ctx: RouteContext) => Promise<Response>;
  cancel: (req: Request, ctx: RouteContext) => Promise<Response>;
  pause: (req: Request, ctx: RouteContext) => Promise<Response>;
  resume: (req: Request, ctx: RouteContext) => Promise<Response>;
  fastForward: (req: Request, ctx: RouteContext) => Promise<Response>;
  trigger: (req: Request, ctx: RouteContext) => Promise<Response>;
};

/**
 * App Router handlers. Wire each into a `route.ts`, e.g.
 * `export const GET = handlers.list` (collection) /
 * `export const POST = handlers.cancel` (`[id]/cancel/route.ts`).
 */
export function createRouteHandlers(api: WorkflowRunsApi): RouteHandlers {
  return {
    list: (req) => api.listRuns(req),
    detail: async (req, ctx) => api.getRun(req, await routeId(ctx)),
    cancel: async (req, ctx) => api.cancelRun(req, await routeId(ctx)),
    pause: async (req, ctx) => api.pauseRun(req, await routeId(ctx)),
    resume: async (req, ctx) => api.resumeRun(req, await routeId(ctx)),
    fastForward: async (req, ctx) => api.fastForwardRun(req, await routeId(ctx)),
    trigger: async (req, ctx) => api.triggerEvent(req, await routeId(ctx)),
  };
}

/**
 * Pages Router: a single catch-all Node API handler. Mount at
 * `pages/api/workflow-runs/[[...path]].ts` and create the api with a matching
 * `basePath` (e.g. `createWorkflowRunsApi({ engine, basePath: '/api/workflow-runs' })`).
 */
export function createPagesApiHandler(
  api: WorkflowRunsApi,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return toNodeHandler(api.fetch);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && npx vitest run src/next/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint + type-check the new files**

Run:
```bash
cd packages/ui
npx biome check --write src/next/index.ts src/next/index.test.ts
npx biome check src/next/index.ts src/next/index.test.ts   # expect: no diagnostics
npx tsc --noEmit -p .                                       # expect: clean
```
If `tsc` flags anything (e.g. an unused import), fix it minimally and re-run.

- [ ] **Step 6: Verify the `./next` export resolves + run the full package suite**

Run:
```bash
cd packages/ui
node -e "const p=require('./package.json'); if(!p.exports['./next']) throw new Error('missing ./next export'); console.log('./next ->', p.exports['./next'].default)"
npx vitest run   # full package suite (server + next), expect all pass
```
Expected: `./next -> ./src/next/index.ts`; full suite green.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/next/index.ts packages/ui/src/next/index.test.ts
git commit -m "feat(ui): add Next.js App Router + Pages Router wrappers"
```
(Do not stage `bun.lock` or any other file.)

---

## Self-Review

- **Spec coverage:** App Router `createRouteHandlers` (all 7 routes, sync + async params) ✓; Pages Router `createPagesApiHandler` via `toNodeHandler` ✓; dependency-free structural typing (no `next` import) ✓; `./next` export verified ✓. Deferred to later plans: TanStack Start docs, client/hooks, UI, demo, `npx`, packaging.
- **Type consistency:** `RouteContext`, `RouteHandlers`, `createRouteHandlers`, `createPagesApiHandler` used identically in impl and tests; op names match `WorkflowRunsApi` (`listRuns`/`getRun`/`cancelRun`/`pauseRun`/`resumeRun`/`fastForwardRun`/`triggerEvent`).
- **Placeholders:** none — every step has runnable code and an exact command.
- **Note:** tests type the mock api via `as never` at call sites to avoid restating the full `WorkflowRunsApi` shape; this is test-only and does not weaken the shipped types (the exported functions are strictly typed as `WorkflowRunsApi`).
```
