# Dashboard Server Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the framework-agnostic HTTP adapter (`createWorkflowRunsApi`) that maps workflow-runs HTTP requests onto the existing `WorkflowEngine` management API, plus a `toNodeHandler` bridge — the server data source every front-end target consumes.

**Architecture:** A Web-standard core (`Request → Response`) with one op per engine method, a `fetch` dispatcher for non-file-based hosts, and a `toNodeHandler` Node `(req,res)` bridge. Reads scope by `resourceId` from an optional `resolveContext(req)` hook; errors map to HTTP status by engine error type. Unit-tested against a **mock engine** (a `Pick<WorkflowEngine, …>` object of `vi.fn()`s) — no database.

**Tech Stack:** TypeScript (ESM), Vitest (jsdom, globals), zod, Web `Request`/`Response`, `node:http`/`node:stream` types. Consumes `pg-workflows` (`WorkflowEngine`, `WorkflowRun`, `WorkflowStatus`, `WorkflowEngineError`, `WorkflowRunNotFoundError`).

## Global Constraints

- **Package:** all code under `packages/ui/`. Branch `feat/pg-workflows-ui-dashboard`.
- **Style (Biome):** single quotes, **semicolons always**, trailing commas `all`, 2-space indent, 100 line width. (Ignore the stale "no semicolons" note in CLAUDE.md.)
- **Naming:** run-centric. HTTP path `id` **is** the `runId`. `resourceId` never comes from the client — only from `resolveContext`. Engine action mapping: `cancelRun→cancelWorkflow`, `pauseRun→pauseWorkflow`, `resumeRun→resumeWorkflow`, `fastForwardRun→fastForwardWorkflow`, `triggerEvent→triggerEvent`.
- **No engine changes.** Consume `pg-workflows` as published.
- **Error mapping:** `WorkflowRunNotFoundError`→404; `WorkflowEngineError` with `.issues`→400; other `WorkflowEngineError`→409; `HttpError`→its status; anything else→500. `resolveContext` throwing→401.
- **Engine signatures (verbatim):**
  - `getRuns({ resourceId?, startingAfter?, endingBefore?, limit?, statuses?, workflowId? }): Promise<{ items: WorkflowRun[]; nextCursor: string|null; prevCursor: string|null; hasMore: boolean; hasPrev: boolean }>`
  - `getRun({ runId, resourceId? }): Promise<WorkflowRun>` (throws `WorkflowRunNotFoundError`)
  - `pauseWorkflow|resumeWorkflow|cancelWorkflow({ runId, resourceId? }): Promise<WorkflowRun>`
  - `fastForwardWorkflow({ runId, resourceId?, data? }): Promise<WorkflowRun>`
  - `triggerEvent({ runId, resourceId?, eventName, data? }): Promise<WorkflowRun>`
- **Run all tests from `packages/ui`:** `cd packages/ui && npx vitest run <file>`.

---

## File Structure

- `packages/ui/src/server/errors.ts` — `HttpError`, `json()`, `toErrorResponse()`.
- `packages/ui/src/server/params.ts` — `parseListParams(url)`, body schemas + `readJson(req)`.
- `packages/ui/src/server/api.ts` — types + `createWorkflowRunsApi(opts)` (ops + `fetch` dispatcher).
- `packages/ui/src/server/node.ts` — `toNodeHandler(fetch)`.
- `packages/ui/src/server/index.ts` — public barrel for `./server`.
- `packages/ui/package.json` — add `./server` to `exports`.

Each `*.ts` has a sibling `*.test.ts`.

---

### Task 1: Error mapping (`server/errors.ts`)

**Files:**
- Create: `packages/ui/src/server/errors.ts`
- Test: `packages/ui/src/server/errors.test.ts`

**Interfaces:**
- Produces:
  - `class HttpError extends Error { status: number; body: unknown; constructor(status: number, body: unknown) }`
  - `json(data: unknown, status?: number): Response`
  - `toErrorResponse(err: unknown): Response`

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui/src/server/errors.test.ts
import { describe, expect, it } from 'vitest';
import { WorkflowEngineError, WorkflowRunNotFoundError } from 'pg-workflows';
import { HttpError, json, toErrorResponse } from './errors';

async function body(res: Response) {
  return { status: res.status, json: await res.json() };
}

describe('json', () => {
  it('serializes data with a JSON content-type and status', async () => {
    const res = json({ ok: true }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('toErrorResponse', () => {
  it('maps WorkflowRunNotFoundError to 404', async () => {
    expect((await body(toErrorResponse(new WorkflowRunNotFoundError('run_1')))).status).toBe(404);
  });

  it('maps WorkflowEngineError with issues to 400', async () => {
    const err = new WorkflowEngineError('bad', undefined, undefined, undefined, [{ message: 'x' }]);
    const { status, json } = await body(toErrorResponse(err));
    expect(status).toBe(400);
    expect(json).toMatchObject({ error: 'validation' });
  });

  it('maps a plain WorkflowEngineError (illegal transition) to 409', async () => {
    const err = new WorkflowEngineError("Cannot resume workflow run in 'running' status");
    expect((await body(toErrorResponse(err))).status).toBe(409);
  });

  it('passes an HttpError through with its own status and body', async () => {
    const { status, json } = await body(toErrorResponse(new HttpError(400, { error: 'validation' })));
    expect(status).toBe(400);
    expect(json).toEqual({ error: 'validation' });
  });

  it('maps unknown errors to 500 without leaking the message', async () => {
    const { status, json } = await body(toErrorResponse(new Error('secret internal detail')));
    expect(status).toBe(500);
    expect(JSON.stringify(json)).not.toContain('secret internal detail');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run src/server/errors.test.ts`
Expected: FAIL — cannot find module `./errors`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/ui/src/server/errors.ts
import { WorkflowEngineError, WorkflowRunNotFoundError } from 'pg-workflows';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(typeof body === 'string' ? body : `HttpError ${status}`);
    this.name = 'HttpError';
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function toErrorResponse(err: unknown): Response {
  if (err instanceof HttpError) return json(err.body, err.status);
  if (err instanceof WorkflowRunNotFoundError) {
    return json({ error: 'not_found', message: err.message }, 404);
  }
  if (err instanceof WorkflowEngineError) {
    if (err.issues) return json({ error: 'validation', message: err.message, issues: err.issues }, 400);
    return json({ error: 'conflict', message: err.message }, 409);
  }
  return json({ error: 'internal', message: 'Internal Server Error' }, 500);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && npx vitest run src/server/errors.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/server/errors.ts packages/ui/src/server/errors.test.ts
git commit -m "feat(ui): add server error mapping (HttpError, json, toErrorResponse)"
```

---

### Task 2: Query + body parsing (`server/params.ts`)

**Files:**
- Create: `packages/ui/src/server/params.ts`
- Test: `packages/ui/src/server/params.test.ts`

**Interfaces:**
- Consumes: `HttpError` from `./errors`.
- Produces:
  - `parseListParams(url: URL): { startingAfter?: string; endingBefore?: string; limit?: number; workflowId?: string; statuses?: WorkflowStatus[] }` (throws `HttpError(400)` on invalid input)
  - `parseTriggerBody(raw: unknown): { eventName: string; data?: Record<string, unknown> }` (throws `HttpError(400)`)
  - `parseFastForwardBody(raw: unknown): { data?: Record<string, unknown> }` (throws `HttpError(400)`)
  - `readJson(req: Request): Promise<unknown>` (returns `{}` for an empty body)

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui/src/server/params.test.ts
import { describe, expect, it } from 'vitest';
import { HttpError } from './errors';
import { parseFastForwardBody, parseListParams, parseTriggerBody, readJson } from './params';

const u = (qs: string) => new URL(`http://x/workflow-runs${qs}`);

describe('parseListParams', () => {
  it('maps snake_case query params to engine camelCase args', () => {
    const url = u('?starting_after=a&ending_before=b&limit=25&workflow_id=k&statuses=running&statuses=paused');
    expect(parseListParams(url)).toEqual({
      startingAfter: 'a',
      endingBefore: 'b',
      limit: 25,
      workflowId: 'k',
      statuses: ['running', 'paused'],
    });
  });

  it('returns an empty object when no params are present', () => {
    expect(parseListParams(u(''))).toEqual({});
  });

  it('throws HttpError 400 on an unknown status value', () => {
    try {
      parseListParams(u('?statuses=bogus'));
      throw new Error('did not throw');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(400);
    }
  });

  it('throws HttpError 400 on a non-positive limit', () => {
    expect(() => parseListParams(u('?limit=0'))).toThrow(HttpError);
  });
});

describe('parseTriggerBody', () => {
  it('accepts eventName with optional data', () => {
    expect(parseTriggerBody({ eventName: 'e', data: { a: 1 } })).toEqual({ eventName: 'e', data: { a: 1 } });
  });
  it('throws HttpError 400 when eventName is missing', () => {
    expect(() => parseTriggerBody({ data: {} })).toThrow(HttpError);
  });
});

describe('parseFastForwardBody', () => {
  it('accepts an empty body', () => {
    expect(parseFastForwardBody({})).toEqual({});
  });
  it('accepts optional data', () => {
    expect(parseFastForwardBody({ data: { x: true } })).toEqual({ data: { x: true } });
  });
});

describe('readJson', () => {
  it('returns {} for an empty body', async () => {
    expect(await readJson(new Request('http://x', { method: 'POST' }))).toEqual({});
  });
  it('parses a JSON body', async () => {
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ a: 1 }) });
    expect(await readJson(req)).toEqual({ a: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run src/server/params.test.ts`
Expected: FAIL — cannot find module `./params`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/ui/src/server/params.ts
import { WorkflowStatus } from 'pg-workflows';
import { z } from 'zod';
import { HttpError } from './errors';

const listQuery = z.object({
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  workflow_id: z.string().optional(),
  statuses: z.array(z.nativeEnum(WorkflowStatus)).optional(),
});

export function parseListParams(url: URL) {
  const statuses = url.searchParams.getAll('statuses');
  const parsed = listQuery.safeParse({
    starting_after: url.searchParams.get('starting_after') ?? undefined,
    ending_before: url.searchParams.get('ending_before') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    workflow_id: url.searchParams.get('workflow_id') ?? undefined,
    statuses: statuses.length ? statuses : undefined,
  });
  if (!parsed.success) throw new HttpError(400, { error: 'validation', issues: parsed.error.issues });
  const d = parsed.data;
  return {
    startingAfter: d.starting_after,
    endingBefore: d.ending_before,
    limit: d.limit,
    workflowId: d.workflow_id,
    statuses: d.statuses,
  };
}

const triggerBody = z.object({
  eventName: z.string().min(1),
  data: z.record(z.unknown()).optional(),
});

const fastForwardBody = z.object({
  data: z.record(z.unknown()).optional(),
});

export function parseTriggerBody(raw: unknown) {
  const parsed = triggerBody.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, { error: 'validation', issues: parsed.error.issues });
  return parsed.data;
}

export function parseFastForwardBody(raw: unknown) {
  const parsed = fastForwardBody.safeParse(raw ?? {});
  if (!parsed.success) throw new HttpError(400, { error: 'validation', issues: parsed.error.issues });
  return parsed.data;
}

export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, { error: 'validation', message: 'Invalid JSON body' });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && npx vitest run src/server/params.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/server/params.ts packages/ui/src/server/params.test.ts
git commit -m "feat(ui): add server query/body parsing with zod validation"
```

---

### Task 3: API reads + scoping (`server/api.ts` — `listRuns`, `getRun`)

**Files:**
- Create: `packages/ui/src/server/api.ts`
- Test: `packages/ui/src/server/api.test.ts`

**Interfaces:**
- Consumes: `parseListParams` (`./params`), `json`/`toErrorResponse` (`./errors`).
- Produces (partial — extended in Tasks 4–5):
  - `type RunsContext = { resourceId?: string }`
  - `type EngineLike = Pick<WorkflowEngine, 'getRuns' | 'getRun' | 'pauseWorkflow' | 'resumeWorkflow' | 'cancelWorkflow' | 'fastForwardWorkflow' | 'triggerEvent'>`
  - `type WorkflowRunsApiOptions = { engine: EngineLike; basePath?: string; resolveContext?: (req: Request) => RunsContext | Promise<RunsContext> }`
  - `type WorkflowRunsApi` with `listRuns(req)`, `getRun(req, id)` (more ops added later)
  - `createWorkflowRunsApi(opts: WorkflowRunsApiOptions): WorkflowRunsApi`

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui/src/server/api.test.ts
import { describe, expect, it, vi } from 'vitest';
import { WorkflowRunNotFoundError } from 'pg-workflows';
import { createWorkflowRunsApi } from './api';

const RUN = { id: 'run_1', workflowId: 'k', status: 'running' } as any;

function mockEngine(overrides: Record<string, unknown> = {}) {
  return {
    getRuns: vi.fn().mockResolvedValue({ items: [RUN], nextCursor: null, prevCursor: null, hasMore: false, hasPrev: false }),
    getRun: vi.fn().mockResolvedValue(RUN),
    pauseWorkflow: vi.fn().mockResolvedValue(RUN),
    resumeWorkflow: vi.fn().mockResolvedValue(RUN),
    cancelWorkflow: vi.fn().mockResolvedValue(RUN),
    fastForwardWorkflow: vi.fn().mockResolvedValue(RUN),
    triggerEvent: vi.fn().mockResolvedValue(RUN),
    ...overrides,
  } as any;
}

describe('createWorkflowRunsApi — reads', () => {
  it('listRuns forwards parsed params + scoped resourceId to engine.getRuns', async () => {
    const engine = mockEngine();
    const api = createWorkflowRunsApi({ engine, resolveContext: () => ({ resourceId: 'tenant_a' }) });
    const res = await api.listRuns(new Request('http://x/workflow-runs?limit=5&statuses=running'));
    expect(res.status).toBe(200);
    expect(engine.getRuns).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5, statuses: ['running'], resourceId: 'tenant_a' }),
    );
  });

  it('getRun forwards runId + resourceId and returns the run', async () => {
    const engine = mockEngine();
    const api = createWorkflowRunsApi({ engine });
    const res = await api.getRun(new Request('http://x/workflow-runs/run_1'), 'run_1');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 'run_1' });
    expect(engine.getRun).toHaveBeenCalledWith({ runId: 'run_1', resourceId: undefined });
  });

  it('returns 404 when the engine throws WorkflowRunNotFoundError', async () => {
    const engine = mockEngine({ getRun: vi.fn().mockRejectedValue(new WorkflowRunNotFoundError('nope')) });
    const api = createWorkflowRunsApi({ engine });
    const res = await api.getRun(new Request('http://x/workflow-runs/nope'), 'nope');
    expect(res.status).toBe(404);
  });

  it('returns 401 when resolveContext throws', async () => {
    const engine = mockEngine();
    const api = createWorkflowRunsApi({
      engine,
      resolveContext: () => {
        throw new Error('no session');
      },
    });
    const res = await api.listRuns(new Request('http://x/workflow-runs'));
    expect(res.status).toBe(401);
    expect(engine.getRuns).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run src/server/api.test.ts`
Expected: FAIL — cannot find module `./api`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/ui/src/server/api.ts
import type { WorkflowEngine } from 'pg-workflows';
import { json, toErrorResponse } from './errors';
import { parseListParams } from './params';

export type RunsContext = { resourceId?: string };

export type EngineLike = Pick<
  WorkflowEngine,
  'getRuns' | 'getRun' | 'pauseWorkflow' | 'resumeWorkflow' | 'cancelWorkflow' | 'fastForwardWorkflow' | 'triggerEvent'
>;

export type WorkflowRunsApiOptions = {
  engine: EngineLike;
  basePath?: string;
  resolveContext?: (req: Request) => RunsContext | Promise<RunsContext>;
};

export type WorkflowRunsApi = {
  listRuns: (req: Request) => Promise<Response>;
  getRun: (req: Request, id: string) => Promise<Response>;
};

export function createWorkflowRunsApi(opts: WorkflowRunsApiOptions): WorkflowRunsApi {
  const { engine, resolveContext } = opts;

  async function context(req: Request): Promise<RunsContext | Response> {
    if (!resolveContext) return {};
    try {
      return await resolveContext(req);
    } catch {
      return json({ error: 'unauthorized' }, 401);
    }
  }

  return {
    async listRuns(req) {
      const ctx = await context(req);
      if (ctx instanceof Response) return ctx;
      try {
        const params = parseListParams(new URL(req.url));
        const result = await engine.getRuns({ ...params, resourceId: ctx.resourceId });
        return json(result, 200);
      } catch (err) {
        return toErrorResponse(err);
      }
    },

    async getRun(req, id) {
      const ctx = await context(req);
      if (ctx instanceof Response) return ctx;
      try {
        const run = await engine.getRun({ runId: id, resourceId: ctx.resourceId });
        return json(run, 200);
      } catch (err) {
        return toErrorResponse(err);
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && npx vitest run src/server/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/server/api.ts packages/ui/src/server/api.test.ts
git commit -m "feat(ui): add WorkflowRunsApi reads (listRuns, getRun) with resourceId scoping"
```

---

### Task 4: API lifecycle actions (`server/api.ts` — cancel/pause/resume/fast-forward/trigger)

**Files:**
- Modify: `packages/ui/src/server/api.ts`
- Test: `packages/ui/src/server/api.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `parseTriggerBody`, `parseFastForwardBody`, `readJson` (`./params`); the `context()` helper from Task 3.
- Produces: extends `WorkflowRunsApi` with `cancelRun(req,id)`, `pauseRun(req,id)`, `resumeRun(req,id)`, `fastForwardRun(req,id)`, `triggerEvent(req,id)` — all `=> Promise<Response>`.

- [ ] **Step 1: Write the failing test (append to api.test.ts)**

```ts
describe('createWorkflowRunsApi — actions', () => {
  it('cancelRun calls engine.cancelWorkflow with scoped runId and returns the run', async () => {
    const engine = mockEngine();
    const api = createWorkflowRunsApi({ engine, resolveContext: () => ({ resourceId: 't1' }) });
    const res = await api.cancelRun(new Request('http://x/workflow-runs/run_1/cancel', { method: 'POST' }), 'run_1');
    expect(res.status).toBe(200);
    expect(engine.cancelWorkflow).toHaveBeenCalledWith({ runId: 'run_1', resourceId: 't1' });
  });

  it('pauseRun and resumeRun map to their engine methods', async () => {
    const engine = mockEngine();
    const api = createWorkflowRunsApi({ engine });
    await api.pauseRun(new Request('http://x', { method: 'POST' }), 'r');
    await api.resumeRun(new Request('http://x', { method: 'POST' }), 'r');
    expect(engine.pauseWorkflow).toHaveBeenCalledWith({ runId: 'r', resourceId: undefined });
    expect(engine.resumeWorkflow).toHaveBeenCalledWith({ runId: 'r', resourceId: undefined });
  });

  it('fastForwardRun passes optional data', async () => {
    const engine = mockEngine();
    const api = createWorkflowRunsApi({ engine });
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ data: { k: 1 } }) });
    await api.fastForwardRun(req, 'r');
    expect(engine.fastForwardWorkflow).toHaveBeenCalledWith({ runId: 'r', resourceId: undefined, data: { k: 1 } });
  });

  it('triggerEvent requires eventName and forwards data', async () => {
    const engine = mockEngine();
    const api = createWorkflowRunsApi({ engine });
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ eventName: 'go', data: { a: 1 } }) });
    await api.triggerEvent(req, 'r');
    expect(engine.triggerEvent).toHaveBeenCalledWith({ runId: 'r', resourceId: undefined, eventName: 'go', data: { a: 1 } });
  });

  it('triggerEvent returns 400 when eventName is missing', async () => {
    const engine = mockEngine();
    const api = createWorkflowRunsApi({ engine });
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ data: {} }) });
    const res = await api.triggerEvent(req, 'r');
    expect(res.status).toBe(400);
    expect(engine.triggerEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run src/server/api.test.ts`
Expected: FAIL — `api.cancelRun is not a function`.

- [ ] **Step 3: Write minimal implementation**

Update the import line and add the five ops to the returned object in `api.ts`.

```ts
// change the import in api.ts:
import { parseFastForwardBody, parseListParams, parseTriggerBody, readJson } from './params';
```

Extend the `WorkflowRunsApi` type:

```ts
export type WorkflowRunsApi = {
  listRuns: (req: Request) => Promise<Response>;
  getRun: (req: Request, id: string) => Promise<Response>;
  cancelRun: (req: Request, id: string) => Promise<Response>;
  pauseRun: (req: Request, id: string) => Promise<Response>;
  resumeRun: (req: Request, id: string) => Promise<Response>;
  fastForwardRun: (req: Request, id: string) => Promise<Response>;
  triggerEvent: (req: Request, id: string) => Promise<Response>;
};
```

Add these ops inside the returned object (after `getRun`):

```ts
    async cancelRun(req, id) {
      const ctx = await context(req);
      if (ctx instanceof Response) return ctx;
      try {
        return json(await engine.cancelWorkflow({ runId: id, resourceId: ctx.resourceId }), 200);
      } catch (err) {
        return toErrorResponse(err);
      }
    },

    async pauseRun(req, id) {
      const ctx = await context(req);
      if (ctx instanceof Response) return ctx;
      try {
        return json(await engine.pauseWorkflow({ runId: id, resourceId: ctx.resourceId }), 200);
      } catch (err) {
        return toErrorResponse(err);
      }
    },

    async resumeRun(req, id) {
      const ctx = await context(req);
      if (ctx instanceof Response) return ctx;
      try {
        return json(await engine.resumeWorkflow({ runId: id, resourceId: ctx.resourceId }), 200);
      } catch (err) {
        return toErrorResponse(err);
      }
    },

    async fastForwardRun(req, id) {
      const ctx = await context(req);
      if (ctx instanceof Response) return ctx;
      try {
        const { data } = parseFastForwardBody(await readJson(req));
        return json(await engine.fastForwardWorkflow({ runId: id, resourceId: ctx.resourceId, data }), 200);
      } catch (err) {
        return toErrorResponse(err);
      }
    },

    async triggerEvent(req, id) {
      const ctx = await context(req);
      if (ctx instanceof Response) return ctx;
      try {
        const { eventName, data } = parseTriggerBody(await readJson(req));
        return json(
          await engine.triggerEvent({ runId: id, resourceId: ctx.resourceId, eventName, data }),
          200,
        );
      } catch (err) {
        return toErrorResponse(err);
      }
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && npx vitest run src/server/api.test.ts`
Expected: PASS (reads + actions).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/server/api.ts packages/ui/src/server/api.test.ts
git commit -m "feat(ui): add WorkflowRunsApi lifecycle actions (cancel/pause/resume/fast-forward/trigger)"
```

---

### Task 5: `fetch` dispatcher (`server/api.ts`)

**Files:**
- Modify: `packages/ui/src/server/api.ts`
- Test: `packages/ui/src/server/api.test.ts` (add a describe block)

**Interfaces:**
- Produces: extends `WorkflowRunsApi` with `fetch: (req: Request) => Promise<Response>` — dispatches by method + path relative to `basePath` (default `/workflow-runs`) onto the ops above. Unknown path → 404; wrong method → 405.

- [ ] **Step 1: Write the failing test (append to api.test.ts)**

```ts
describe('createWorkflowRunsApi — fetch dispatcher', () => {
  it('routes GET /workflow-runs to listRuns', async () => {
    const engine = mockEngine();
    const api = createWorkflowRunsApi({ engine });
    const res = await api.fetch(new Request('http://x/workflow-runs?limit=2'));
    expect(res.status).toBe(200);
    expect(engine.getRuns).toHaveBeenCalled();
  });

  it('routes GET /workflow-runs/:id to getRun', async () => {
    const engine = mockEngine();
    const api = createWorkflowRunsApi({ engine });
    await api.fetch(new Request('http://x/workflow-runs/run_1'));
    expect(engine.getRun).toHaveBeenCalledWith({ runId: 'run_1', resourceId: undefined });
  });

  it('routes POST /workflow-runs/:id/cancel to cancelWorkflow', async () => {
    const engine = mockEngine();
    const api = createWorkflowRunsApi({ engine });
    await api.fetch(new Request('http://x/workflow-runs/run_1/cancel', { method: 'POST' }));
    expect(engine.cancelWorkflow).toHaveBeenCalledWith({ runId: 'run_1', resourceId: undefined });
  });

  it('honors a custom basePath', async () => {
    const engine = mockEngine();
    const api = createWorkflowRunsApi({ engine, basePath: '/api/wfr' });
    const res = await api.fetch(new Request('http://x/api/wfr/run_1/pause', { method: 'POST' }));
    expect(res.status).toBe(200);
    expect(engine.pauseWorkflow).toHaveBeenCalledWith({ runId: 'run_1', resourceId: undefined });
  });

  it('returns 404 for an unknown path and 405 for a wrong method', async () => {
    const engine = mockEngine();
    const api = createWorkflowRunsApi({ engine });
    expect((await api.fetch(new Request('http://x/other'))).status).toBe(404);
    expect((await api.fetch(new Request('http://x/workflow-runs/run_1/cancel'))).status).toBe(405);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run src/server/api.test.ts`
Expected: FAIL — `api.fetch is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add `fetch: (req: Request) => Promise<Response>;` to the `WorkflowRunsApi` type. Then, inside `createWorkflowRunsApi`, build the ops object into a `const api` first, add a dispatcher that references it, and return `{ ...api, fetch }`. Replace the `return { … }` with:

```ts
  const api = {
    async listRuns(req: Request) { /* unchanged body */ },
    async getRun(req: Request, id: string) { /* unchanged body */ },
    async cancelRun(req: Request, id: string) { /* unchanged body */ },
    async pauseRun(req: Request, id: string) { /* unchanged body */ },
    async resumeRun(req: Request, id: string) { /* unchanged body */ },
    async fastForwardRun(req: Request, id: string) { /* unchanged body */ },
    async triggerEvent(req: Request, id: string) { /* unchanged body */ },
  };

  const basePath = (opts.basePath ?? '/workflow-runs').replace(/\/$/, '');

  const ACTIONS: Record<string, (req: Request, id: string) => Promise<Response>> = {
    cancel: api.cancelRun,
    pause: api.pauseRun,
    resume: api.resumeRun,
    'fast-forward': api.fastForwardRun,
    trigger: api.triggerEvent,
  };

  async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) {
      return json({ error: 'not_found' }, 404);
    }
    const rest = url.pathname.slice(basePath.length).replace(/^\//, '');
    const segments = rest ? rest.split('/') : [];

    if (segments.length === 0) {
      if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      return api.listRuns(req);
    }
    const [id, action] = segments;
    if (segments.length === 1) {
      if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      return api.getRun(req, id);
    }
    if (segments.length === 2 && ACTIONS[action]) {
      if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      return ACTIONS[action](req, id);
    }
    return json({ error: 'not_found' }, 404);
  }

  return { ...api, fetch };
```

Note: move the op bodies from Tasks 3–4 into this `const api` object verbatim (same bodies, now methods of `api`). The `context()` helper stays a closure above `api`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && npx vitest run src/server/api.test.ts`
Expected: PASS (reads + actions + dispatcher).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/server/api.ts packages/ui/src/server/api.test.ts
git commit -m "feat(ui): add fetch dispatcher to WorkflowRunsApi (path+method routing)"
```

---

### Task 6: Node bridge (`server/node.ts`)

**Files:**
- Create: `packages/ui/src/server/node.ts`
- Test: `packages/ui/src/server/node.test.ts`

**Interfaces:**
- Produces: `toNodeHandler(fetchHandler: (req: Request) => Promise<Response>): (req: IncomingMessage, res: ServerResponse) => Promise<void>` — converts a Node request into a Web `Request`, runs the handler, writes status/headers/body back. For Node/Express/Pages/standalone.

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui/src/server/node.test.ts
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { toNodeHandler } from './node';

function fakeReq(method: string, url: string, body?: string) {
  const stream = Readable.from(body ? [Buffer.from(body)] : []) as any;
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

describe('toNodeHandler', () => {
  it('bridges a GET into the fetch handler and writes the response back', async () => {
    const handler = toNodeHandler(async (req) => {
      expect(new URL(req.url).pathname).toBe('/workflow-runs');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const res = fakeRes();
    await handler(fakeReq('GET', '/workflow-runs') as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('forwards a POST body', async () => {
    const handler = toNodeHandler(async (req) => {
      const json = await req.json();
      return new Response(JSON.stringify(json), { status: 201 });
    });
    const res = fakeRes();
    await handler(fakeReq('POST', '/workflow-runs/r/trigger', JSON.stringify({ eventName: 'e' })) as any, res as any);
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toEqual({ eventName: 'e' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run src/server/node.test.ts`
Expected: FAIL — cannot find module `./node`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/ui/src/server/node.ts
import type { IncomingMessage, ServerResponse } from 'node:http';

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const method = (req.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

export function toNodeHandler(fetchHandler: (req: Request) => Promise<Response>) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const host = req.headers.host ?? 'localhost';
    const url = `http://${host}${req.url ?? '/'}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers.set(k, v);
      else if (Array.isArray(v)) headers.set(k, v.join(', '));
    }
    const body = await readBody(req);
    const request = new Request(url, { method: req.method, headers, body });
    const response = await fetchHandler(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    const buf = Buffer.from(await response.arrayBuffer());
    res.end(buf);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && npx vitest run src/server/node.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/server/node.ts packages/ui/src/server/node.test.ts
git commit -m "feat(ui): add toNodeHandler bridge (Web Request/Response <-> Node req/res)"
```

---

### Task 7: Public barrel + `./server` export

**Files:**
- Create: `packages/ui/src/server/index.ts`
- Modify: `packages/ui/package.json` (add `./server` to `exports`)
- Test: `packages/ui/src/server/index.test.ts`

**Interfaces:**
- Produces: `./server` public surface — `createWorkflowRunsApi`, `toNodeHandler`, `toErrorResponse`, `HttpError`, and types `WorkflowRunsApi`, `WorkflowRunsApiOptions`, `RunsContext`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui/src/server/index.test.ts
import { describe, expect, it } from 'vitest';
import * as server from './index';

describe('server barrel', () => {
  it('exports the public server surface', () => {
    expect(typeof server.createWorkflowRunsApi).toBe('function');
    expect(typeof server.toNodeHandler).toBe('function');
    expect(typeof server.toErrorResponse).toBe('function');
    expect(typeof server.HttpError).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run src/server/index.test.ts`
Expected: FAIL — cannot find module `./index`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/ui/src/server/index.ts
export { HttpError, toErrorResponse } from './errors';
export { toNodeHandler } from './node';
export {
  createWorkflowRunsApi,
  type EngineLike,
  type RunsContext,
  type WorkflowRunsApi,
  type WorkflowRunsApiOptions,
} from './api';
```

Then add the `./server` entry to `packages/ui/package.json` `exports` (place it alongside `./client`):

```json
    "./server": {
      "types": "./src/server/index.ts",
      "default": "./src/server/index.ts"
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && npx vitest run src/server/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check the whole package**

Run: `cd packages/ui && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run the full server suite**

Run: `cd packages/ui && npx vitest run src/server`
Expected: PASS (all Task 1–7 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/server/index.ts packages/ui/src/server/index.test.ts packages/ui/package.json
git commit -m "feat(ui): export ./server surface (createWorkflowRunsApi, toNodeHandler)"
```

---

## Self-Review

- **Spec coverage (adapter portions):** `createWorkflowRunsApi` + all 7 ops (Tasks 3–5) ✓; `fetch` dispatcher (Task 5) ✓; `toNodeHandler` (Task 6) ✓; `resolveContext`/401 scoping (Task 3) ✓; error mapping 400/401/404/409/500 (Tasks 1,3,4) ✓; `./server` export (Task 7) ✓. Deferred to later plans: Next wrappers, client/hooks, UI assembly, demo, `npx`, packaging.
- **Naming/type consistency:** `EngineLike`, `RunsContext`, `WorkflowRunsApi`, `WorkflowRunsApiOptions`, `createWorkflowRunsApi`, `toNodeHandler`, `HttpError`, `json`, `toErrorResponse`, `parseListParams`, `parseTriggerBody`, `parseFastForwardBody`, `readJson` used identically across tasks. Op names (`listRuns`, `getRun`, `cancelRun`, `pauseRun`, `resumeRun`, `fastForwardRun`, `triggerEvent`) match the spec's Naming map and engine methods.
- **Note for Task 5:** the op bodies written in Tasks 3–4 move verbatim into the `const api` object; behavior is unchanged, only the surrounding structure changes so `fetch` can reference them.
- **Placeholders:** none — every step has runnable code and an exact command.
```
