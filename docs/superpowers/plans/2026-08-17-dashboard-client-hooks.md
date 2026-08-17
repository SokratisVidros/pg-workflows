# Dashboard Client + Mutation Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the `WorkflowRunsClient` (interface + `createFetchClient`) with the five lifecycle-action methods, and add matching React Query mutation hooks, so the dashboard (and headless consumers) can cancel/pause/resume/fast-forward/trigger runs.

**Architecture:** Task 1 adds `cancelRun`/`pauseRun`/`resumeRun`/`fastForwardRun`/`triggerEvent` to the client (POST to `{baseUrl}/{id}/{action}`, returns the updated `WorkflowRun`) and updates the existing `WorkflowRunsClient` mocks so the suite stays green. Task 2 adds `useCancelRun`…`useTriggerEvent` (each invalidates the run + runs queries on success) and exports them from the hooks barrel.

**Tech Stack:** TypeScript (ESM), Vitest (jsdom, globals), `@tanstack/react-query` v5, `@testing-library/react` v16. Consumes `WorkflowRun` from `pg-workflows/client`.

## Global Constraints

- **Package:** all code under `packages/ui/`. Branch `feat/pg-workflows-ui-dashboard`.
- **Style (Biome, enforced):** single quotes, semicolons always, trailing commas `all`, 2-space, 100-char width, `organizeImports`. Run `npx biome check --write` on changed files before committing.
- **`tsc --noEmit -p .` must be clean** (package uses `noUncheckedIndexedAccess: true`).
- **Client hooks are `'use client'`** — every hook file starts with the `'use client';` directive, matching the existing hooks.
- **Endpoints (must match the server adapter + route tree):** `POST {baseUrl}/{id}/cancel`, `/pause`, `/resume`, `/fast-forward`, `/trigger`. `fast-forward` body `{ data? }`; `trigger` body `{ eventName, data? }`; the other three send no body. All return the updated `WorkflowRun`.
- **Query keys (must match existing hooks):** a run detail is `['pgw', 'run', id]`; the runs list is `['pgw', 'runs', ...]`. Invalidate `['pgw','run',id]` and `['pgw','runs']` on mutation success.
- **No engine and no server-adapter changes** — this plan is client + hooks only.
- **Run tests from `packages/ui`:** `cd packages/ui && npx vitest run <file>` (or no arg for the full suite).

---

## File Structure

- `packages/ui/src/client.ts` — extend `WorkflowRunsClient` + `createFetchClient` (Task 1).
- `packages/ui/src/client.test.ts` — add mutation-method tests (Task 1).
- `packages/ui/src/provider.test.tsx`, `packages/ui/src/hooks/use-workflow-runs.test.tsx`, `packages/ui/src/hooks/use-workflow-run.test.tsx` — update the `WorkflowRunsClient` mocks to add the five new methods (Task 1).
- `packages/ui/src/hooks/use-run-mutations.ts` — the five mutation hooks (Task 2).
- `packages/ui/src/hooks/use-run-mutations.test.tsx` — hook tests (Task 2).
- `packages/ui/src/hooks/index.ts` — export the new hooks (Task 2).

---

### Task 1: Client mutation methods (`client.ts`)

**Files:**
- Modify: `packages/ui/src/client.ts`
- Test: `packages/ui/src/client.test.ts` (add a describe block)
- Modify (mock updates): `packages/ui/src/provider.test.tsx`, `packages/ui/src/hooks/use-workflow-runs.test.tsx`, `packages/ui/src/hooks/use-workflow-run.test.tsx`

**Interfaces:**
- Produces:
  - `type FastForwardBody = { data?: Record<string, unknown> }`
  - `type TriggerEventBody = { eventName: string; data?: Record<string, unknown> }`
  - `WorkflowRunsClient` gains: `cancelRun(id: string): Promise<WorkflowRun>`, `pauseRun(id)`, `resumeRun(id)`, `fastForwardRun(id: string, body?: FastForwardBody): Promise<WorkflowRun>`, `triggerEvent(id: string, body: TriggerEventBody): Promise<WorkflowRun>`
  - `createFetchClient` implements all five.

- [ ] **Step 1: Write the failing test** (append to `packages/ui/src/client.test.ts`)

```ts
describe('createFetchClient mutations', () => {
  function okRun(fields: Record<string, unknown>) {
    return new Response(JSON.stringify(fields), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('cancelRun POSTs to {baseUrl}/{id}/cancel and returns the run', async () => {
    const fetch = vi.fn().mockResolvedValue(okRun({ id: 'run_x', status: 'cancelled' }));
    const client = createFetchClient({ baseUrl: '/api/wfr', fetch });
    const run = await client.cancelRun('run_x');
    expect(run.status).toBe('cancelled');
    expect(fetch).toHaveBeenCalledWith('/api/wfr/run_x/cancel', expect.objectContaining({ method: 'POST' }));
  });

  it('pauseRun and resumeRun POST to their action paths', async () => {
    const fetch = vi.fn().mockResolvedValue(okRun({ id: 'r' }));
    const client = createFetchClient({ baseUrl: '/api/wfr', fetch });
    await client.pauseRun('r');
    await client.resumeRun('r');
    expect(fetch.mock.calls[0][0]).toBe('/api/wfr/r/pause');
    expect(fetch.mock.calls[1][0]).toBe('/api/wfr/r/resume');
  });

  it('fastForwardRun sends an optional JSON data body', async () => {
    const fetch = vi.fn().mockResolvedValue(okRun({ id: 'r' }));
    const client = createFetchClient({ baseUrl: '/api/wfr', fetch });
    await client.fastForwardRun('r', { data: { k: 1 } });
    const init = fetch.mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ data: { k: 1 } });
  });

  it('triggerEvent POSTs eventName + data to the trigger path', async () => {
    const fetch = vi.fn().mockResolvedValue(okRun({ id: 'r' }));
    const client = createFetchClient({ baseUrl: '/api/wfr', fetch });
    await client.triggerEvent('r', { eventName: 'go', data: { a: 1 } });
    expect(fetch.mock.calls[0][0]).toBe('/api/wfr/r/trigger');
    expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toEqual({ eventName: 'go', data: { a: 1 } });
  });

  it('throws on a non-2xx action response', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('conflict', { status: 409 }));
    const client = createFetchClient({ baseUrl: '/api/wfr', fetch });
    await expect(client.pauseRun('r')).rejects.toThrow(/409/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run src/client.test.ts`
Expected: FAIL — `client.cancelRun is not a function` (and type errors).

- [ ] **Step 3: Write minimal implementation** in `packages/ui/src/client.ts`

Add the body types after `WorkflowRunStatus`:

```ts
export type FastForwardBody = { data?: Record<string, unknown> };
export type TriggerEventBody = { eventName: string; data?: Record<string, unknown> };
```

Extend the interface:

```ts
export interface WorkflowRunsClient {
  listRuns(params: ListRunsParams): Promise<ListRunsResult>;
  getRun(id: string): Promise<WorkflowRun>;
  cancelRun(id: string): Promise<WorkflowRun>;
  pauseRun(id: string): Promise<WorkflowRun>;
  resumeRun(id: string): Promise<WorkflowRun>;
  fastForwardRun(id: string, body?: FastForwardBody): Promise<WorkflowRun>;
  triggerEvent(id: string, body: TriggerEventBody): Promise<WorkflowRun>;
}
```

Inside `createFetchClient`, add a `postAction` helper above the `return`, and the five methods in the returned object:

```ts
  async function postAction(target: string, body?: unknown): Promise<WorkflowRun> {
    const init: RequestInit = { method: 'POST' };
    if (body !== undefined) {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const res = await fetchImpl(target, init);
    if (!res.ok) throw new Error(`POST ${target} failed: ${res.status}`);
    return (await res.json()) as WorkflowRun;
  }
```

```ts
    async cancelRun(id) {
      return postAction(`${trimmed}/${encodeURIComponent(id)}/cancel`);
    },
    async pauseRun(id) {
      return postAction(`${trimmed}/${encodeURIComponent(id)}/pause`);
    },
    async resumeRun(id) {
      return postAction(`${trimmed}/${encodeURIComponent(id)}/resume`);
    },
    async fastForwardRun(id, body) {
      return postAction(`${trimmed}/${encodeURIComponent(id)}/fast-forward`, body);
    },
    async triggerEvent(id, body) {
      return postAction(`${trimmed}/${encodeURIComponent(id)}/trigger`, body);
    },
```

- [ ] **Step 4: Update the existing `WorkflowRunsClient` mocks so tsc + suite stay green**

Adding required interface methods breaks every mock typed `: WorkflowRunsClient`. In EACH of these three files, add the five methods (as `vi.fn()`) to the mock-client object literal:

```ts
    cancelRun: vi.fn(),
    pauseRun: vi.fn(),
    resumeRun: vi.fn(),
    fastForwardRun: vi.fn(),
    triggerEvent: vi.fn(),
```

- `packages/ui/src/provider.test.tsx`
- `packages/ui/src/hooks/use-workflow-runs.test.tsx` (the `makeClient()` return)
- `packages/ui/src/hooks/use-workflow-run.test.tsx`

(If any of these already builds its mock a different way, add the five methods however that file constructs its client so it still satisfies `WorkflowRunsClient`.)

- [ ] **Step 5: Verify (lint, types, focused + full suite)**

Run:
```bash
cd packages/ui
npx biome check --write src/client.ts src/client.test.ts src/provider.test.tsx src/hooks/use-workflow-runs.test.tsx src/hooks/use-workflow-run.test.tsx
npx biome check src/client.ts src/client.test.ts   # expect no diagnostics
npx tsc --noEmit -p .                               # expect clean (proves mocks updated)
npx vitest run                                      # full suite, expect all pass
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/client.ts packages/ui/src/client.test.ts packages/ui/src/provider.test.tsx packages/ui/src/hooks/use-workflow-runs.test.tsx packages/ui/src/hooks/use-workflow-run.test.tsx
git commit -m "feat(ui): add client mutation methods (cancel/pause/resume/fast-forward/trigger)"
```
(Do not stage `bun.lock`.)

---

### Task 2: Mutation hooks (`hooks/use-run-mutations.ts`)

**Files:**
- Create: `packages/ui/src/hooks/use-run-mutations.ts`
- Create: `packages/ui/src/hooks/use-run-mutations.test.tsx`
- Modify: `packages/ui/src/hooks/index.ts` (add exports)

**Interfaces:**
- Consumes: `useWorkflowRunsClient` (`./use-workflow-runs-client`), `WorkflowRun` (`../client`), `useMutation`/`useQueryClient` (`@tanstack/react-query`).
- Produces (all React Query mutation hooks):
  - `useCancelRun()` → mutation over `{ id: string }`
  - `usePauseRun()` → `{ id: string }`
  - `useResumeRun()` → `{ id: string }`
  - `useFastForwardRun()` → `{ id: string; data?: Record<string, unknown> }`
  - `useTriggerEvent()` → `{ id: string; eventName: string; data?: Record<string, unknown> }`
  Each returns the updated `WorkflowRun` and, on success, invalidates `['pgw','run',id]` and `['pgw','runs']`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/ui/src/hooks/use-run-mutations.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowRunsClient } from '../client';
import { WorkflowRunsProvider } from '../provider';
import {
  useCancelRun,
  useFastForwardRun,
  usePauseRun,
  useResumeRun,
  useTriggerEvent,
} from './use-run-mutations';

function makeClient(): WorkflowRunsClient {
  const run = { id: 'run_1', status: 'cancelled' } as never;
  return {
    listRuns: vi.fn(),
    getRun: vi.fn(),
    cancelRun: vi.fn().mockResolvedValue(run),
    pauseRun: vi.fn().mockResolvedValue(run),
    resumeRun: vi.fn().mockResolvedValue(run),
    fastForwardRun: vi.fn().mockResolvedValue(run),
    triggerEvent: vi.fn().mockResolvedValue(run),
  };
}

function setup() {
  const client = makeClient();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <WorkflowRunsProvider client={client} pollIntervalMs={0}>
        {children}
      </WorkflowRunsProvider>
    </QueryClientProvider>
  );
  return { client, invalidate, wrapper };
}

describe('run mutation hooks', () => {
  it('useCancelRun calls client.cancelRun and invalidates run + runs queries', async () => {
    const { client, invalidate, wrapper } = setup();
    const { result } = renderHook(() => useCancelRun(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'run_1' });
    });
    expect(client.cancelRun).toHaveBeenCalledWith('run_1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['pgw', 'run', 'run_1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['pgw', 'runs'] });
  });

  it('usePauseRun and useResumeRun call their client methods', async () => {
    const { client, wrapper } = setup();
    const pause = renderHook(() => usePauseRun(), { wrapper });
    const resume = renderHook(() => useResumeRun(), { wrapper });
    await act(async () => {
      await pause.result.current.mutateAsync({ id: 'run_1' });
      await resume.result.current.mutateAsync({ id: 'run_1' });
    });
    expect(client.pauseRun).toHaveBeenCalledWith('run_1');
    expect(client.resumeRun).toHaveBeenCalledWith('run_1');
  });

  it('useFastForwardRun forwards optional data', async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useFastForwardRun(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'run_1', data: { k: 1 } });
    });
    expect(client.fastForwardRun).toHaveBeenCalledWith('run_1', { data: { k: 1 } });
  });

  it('useTriggerEvent forwards eventName + data', async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useTriggerEvent(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'run_1', eventName: 'go', data: { a: 1 } });
    });
    expect(client.triggerEvent).toHaveBeenCalledWith('run_1', { eventName: 'go', data: { a: 1 } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run src/hooks/use-run-mutations.test.tsx`
Expected: FAIL — cannot find module `./use-run-mutations`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/ui/src/hooks/use-run-mutations.ts
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { WorkflowRun } from '../client';
import { useWorkflowRunsClient } from './use-workflow-runs-client';

function useInvalidateRun() {
  const qc = useQueryClient();
  return (id: string) => {
    qc.invalidateQueries({ queryKey: ['pgw', 'run', id] });
    qc.invalidateQueries({ queryKey: ['pgw', 'runs'] });
  };
}

export function useCancelRun() {
  const { client } = useWorkflowRunsClient();
  const invalidate = useInvalidateRun();
  return useMutation<WorkflowRun, Error, { id: string }>({
    mutationFn: ({ id }) => client.cancelRun(id),
    onSuccess: (_run, { id }) => invalidate(id),
  });
}

export function usePauseRun() {
  const { client } = useWorkflowRunsClient();
  const invalidate = useInvalidateRun();
  return useMutation<WorkflowRun, Error, { id: string }>({
    mutationFn: ({ id }) => client.pauseRun(id),
    onSuccess: (_run, { id }) => invalidate(id),
  });
}

export function useResumeRun() {
  const { client } = useWorkflowRunsClient();
  const invalidate = useInvalidateRun();
  return useMutation<WorkflowRun, Error, { id: string }>({
    mutationFn: ({ id }) => client.resumeRun(id),
    onSuccess: (_run, { id }) => invalidate(id),
  });
}

export function useFastForwardRun() {
  const { client } = useWorkflowRunsClient();
  const invalidate = useInvalidateRun();
  return useMutation<WorkflowRun, Error, { id: string; data?: Record<string, unknown> }>({
    mutationFn: ({ id, data }) => client.fastForwardRun(id, { data }),
    onSuccess: (_run, { id }) => invalidate(id),
  });
}

export function useTriggerEvent() {
  const { client } = useWorkflowRunsClient();
  const invalidate = useInvalidateRun();
  return useMutation<WorkflowRun, Error, { id: string; eventName: string; data?: Record<string, unknown> }>({
    mutationFn: ({ id, eventName, data }) => client.triggerEvent(id, { eventName, data }),
    onSuccess: (_run, { id }) => invalidate(id),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && npx vitest run src/hooks/use-run-mutations.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Export from the hooks barrel** — add to `packages/ui/src/hooks/index.ts`:

```ts
export {
  useCancelRun,
  useFastForwardRun,
  usePauseRun,
  useResumeRun,
  useTriggerEvent,
} from './use-run-mutations';
```

- [ ] **Step 6: Verify (lint, types, full suite)**

Run:
```bash
cd packages/ui
npx biome check --write src/hooks/use-run-mutations.ts src/hooks/use-run-mutations.test.tsx src/hooks/index.ts
npx biome check src/hooks/use-run-mutations.ts src/hooks/use-run-mutations.test.tsx   # no diagnostics
npx tsc --noEmit -p .                                                                 # clean
npx vitest run                                                                        # full suite passes
```

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/hooks/use-run-mutations.ts packages/ui/src/hooks/use-run-mutations.test.tsx packages/ui/src/hooks/index.ts
git commit -m "feat(ui): add run mutation hooks (useCancelRun..useTriggerEvent)"
```
(Do not stage `bun.lock`.)

---

## Self-Review

- **Spec coverage:** client mutation methods for all 5 actions (Task 1) ✓; correct endpoints + bodies ✓; returns updated `WorkflowRun` ✓; mutation hooks for all 5 with query invalidation (Task 2) ✓; barrel exports ✓ (headless surface). Existing mocks updated so the interface change keeps the suite + tsc green (Task 1 Step 4) ✓.
- **Type consistency:** `FastForwardBody`/`TriggerEventBody`, method names (`cancelRun`/`pauseRun`/`resumeRun`/`fastForwardRun`/`triggerEvent`), hook names (`useCancelRun`/`usePauseRun`/`useResumeRun`/`useFastForwardRun`/`useTriggerEvent`), and query keys (`['pgw','run',id]`, `['pgw','runs']`) match the existing hooks and the server route tree.
- **Placeholders:** none — every step has runnable code and an exact command.
- **Cross-file risk handled:** Task 1 Step 4 explicitly updates the three `WorkflowRunsClient` mocks; `tsc --noEmit` in Step 5 is the gate that proves no mock was missed.
```
