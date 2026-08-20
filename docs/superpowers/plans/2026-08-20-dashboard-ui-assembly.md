# Dashboard UI Assembly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assemble the existing leaf components + hooks into the visible dashboard: `RunsTable`, `Pagination`, `RunDetail`, and a self-contained `<WorkflowRunsDashboard/>` (list → detail-page navigation), then fill the package's public `index.ts`.

**Architecture:** Presentational components (`RunsTable`, `Pagination`) take data + callbacks. `RunDetail` is connected (uses `useWorkflowRun` + the mutation hooks) and gates action buttons by run status. `WorkflowRunsDashboard` is fully self-contained: it creates its own `QueryClient`, builds a `WorkflowRunsClient` from a `client` or `baseUrl` prop, wraps children in `QueryClientProvider` + `WorkflowRunsProvider`, and swaps between the list view and a `RunDetail` page via internal `selectedRunId` state (with optional controlled `selectedRunId`/`onSelectRun` props).

**Tech Stack:** React 19, TypeScript (ESM), `@tanstack/react-query` v5, `@testing-library/react` v16, Vitest (jsdom), Tailwind v4 (existing preset/tokens).

## Global Constraints

- **Package:** all code under `packages/ui/`. Branch `feat/pg-workflows-ui-dashboard`.
- **Style (Biome, enforced):** single quotes, semicolons always, trailing commas `all`, 2-space, 100-char width, `organizeImports`. Run `npx biome check --write` on changed files before committing; commits must be lint- and type-clean (`npx tsc --noEmit -p .`, package uses `noUncheckedIndexedAccess: true`).
- **Client component files start with `'use client';`** (every component that uses hooks/state).
- **Styling:** reuse existing Tailwind classes/utilities and the `cn` helper (`../lib/cn`) — follow the styling idioms already in `status-badge.tsx`, `filter-bar.tsx`, etc. Do NOT invent a new design system; keep it clean and neutral.
- **No engine/server/client/hook API changes** — this plan only adds UI components and the barrel. (The client, hooks, provider, leaf components, and lib helpers already exist and are committed.)
- **Run tests from `packages/ui`:** `cd packages/ui && npx vitest run <file>` (no arg = full suite).

### Existing building blocks (verbatim signatures — consume, do not modify)

- `StatusBadge({ status: WorkflowRunStatus, className? })` — `../components/status-badge` (from `run-detail/` use `../status-badge`).
- `RunDetailHeader({ run: WorkflowRun, onBack?: () => void, className? })` — `./run-detail-header`.
- `StepTimeline({ run: WorkflowRun, className? })` — `./step-timeline`.
- `JsonViewer({ value: unknown, className? })` — `./json-viewer`.
- `LiveIndicator({ isLive, isFetching, onToggle, className? })` — `../components/live-indicator`.
- `FilterBar({ filters: RunFilters, hasActiveFilters, workflowIds: string[], onFiltersChange, onClear })` — `../components/filter-bar/filter-bar`.
- `useRunFilters(initial?)` → `{ filters, setFilters, replaceFilters, clearFilters, toggleSort, hasActiveFilters, serverParams }`. `serverParams` is `{ limit, startingAfter?, endingBefore?, statuses?, workflowId? }` (a `ListRunsParams`).
- `useWorkflowRuns(params: ListRunsParams)` → React Query result of `ListRunsResult` (`{ items, nextCursor, prevCursor, hasMore, hasPrev }`).
- `useWorkflowRun(id: string)` → React Query result of `WorkflowRun`.
- `useCancelRun/usePauseRun/useResumeRun/useFastForwardRun/useTriggerEvent()` — mutations; `.mutate({ id, ... })`.
- `applyClientFilters(runs, { from?, to?, minDuration?, maxDuration?, search? })` and `sortRuns(runs, key, dir)` — `../lib/filters`.
- `computeDurationMs(run)`, `formatDuration(ms)`, `timeAgo(date)`, `isTerminalStatus(status)` — `../lib/duration`.
- `WorkflowRunsProvider({ client, pollIntervalMs?, children })` — `../provider`.
- `createFetchClient({ baseUrl, fetch? })`, types `WorkflowRun`, `WorkflowRunsClient` — `../client`.

---

## File Structure

- `packages/ui/src/components/runs-table.tsx` (+ test) — presentational list table.
- `packages/ui/src/components/pagination.tsx` (+ test) — prev/next cursor controls.
- `packages/ui/src/components/run-detail/run-detail.tsx` (+ test) — connected detail page.
- `packages/ui/src/components/workflow-runs-dashboard.tsx` (+ test) — self-contained top-level.
- `packages/ui/src/index.ts` — replace `export {}` with the full public surface.

---

### Task 1: `RunsTable` (presentational)

**Files:**
- Create: `packages/ui/src/components/runs-table.tsx`
- Test: `packages/ui/src/components/runs-table.test.tsx`

**Interfaces:**
- Produces: `type RunsTableProps = { runs: WorkflowRun[]; onSelectRun: (id: string) => void; isLoading?: boolean; className?: string }`; `function RunsTable(props): JSX.Element`.
- Columns: status (`StatusBadge`), workflowId, run id (shortened to first 8 chars via a local helper, full id in `title`), resourceId (or `—`), created (`timeAgo(createdAt)`), duration (`formatDuration(computeDurationMs(run))` or `—`). Clicking a row calls `onSelectRun(run.id)`. Render a "No runs" empty state when `runs` is empty and not loading; a "Loading…" row when `isLoading` and empty.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/ui/src/components/runs-table.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowRun } from '../client';
import { RunsTable } from './runs-table';

const run = (over: Partial<WorkflowRun> = {}): WorkflowRun =>
  ({
    id: 'run_12345678abc',
    workflowId: 'ingest',
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resourceId: 'tenant_a',
    ...over,
  }) as unknown as WorkflowRun;

describe('RunsTable', () => {
  it('renders a row per run with workflow id and status', () => {
    render(<RunsTable runs={[run(), run({ id: 'run_2', workflowId: 'email', status: 'completed' })]} onSelectRun={() => {}} />);
    expect(screen.getByText('ingest')).toBeInTheDocument();
    expect(screen.getByText('email')).toBeInTheDocument();
  });

  it('calls onSelectRun with the run id when a row is clicked', () => {
    const onSelectRun = vi.fn();
    render(<RunsTable runs={[run({ id: 'run_x' })]} onSelectRun={onSelectRun} />);
    fireEvent.click(screen.getByText('ingest'));
    expect(onSelectRun).toHaveBeenCalledWith('run_x');
  });

  it('shows an empty state when there are no runs', () => {
    render(<RunsTable runs={[]} onSelectRun={() => {}} />);
    expect(screen.getByText(/no runs/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run src/components/runs-table.test.tsx`
Expected: FAIL — cannot find module `./runs-table`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// packages/ui/src/components/runs-table.tsx
'use client';

import type { WorkflowRun } from '../client';
import { cn } from '../lib/cn';
import { computeDurationMs, formatDuration, timeAgo } from '../lib/duration';
import { StatusBadge } from './status-badge';

export type RunsTableProps = {
  runs: WorkflowRun[];
  onSelectRun: (id: string) => void;
  isLoading?: boolean;
  className?: string;
};

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

function durationLabel(run: WorkflowRun): string {
  const ms = computeDurationMs(run);
  return ms == null ? '—' : formatDuration(ms);
}

export function RunsTable({ runs, onSelectRun, isLoading, className }: RunsTableProps) {
  return (
    <table className={cn('w-full border-collapse text-sm', className)}>
      <thead>
        <tr className="border-b text-left text-xs uppercase text-gray-500">
          <th className="px-3 py-2 font-medium">Status</th>
          <th className="px-3 py-2 font-medium">Workflow</th>
          <th className="px-3 py-2 font-medium">Run</th>
          <th className="px-3 py-2 font-medium">Resource</th>
          <th className="px-3 py-2 font-medium">Created</th>
          <th className="px-3 py-2 font-medium">Duration</th>
        </tr>
      </thead>
      <tbody>
        {runs.length === 0 ? (
          <tr>
            <td colSpan={6} className="px-3 py-8 text-center text-gray-500">
              {isLoading ? 'Loading…' : 'No runs'}
            </td>
          </tr>
        ) : (
          runs.map((run) => {
            const resourceId = (run as unknown as { resourceId?: string | null }).resourceId;
            return (
              <tr
                key={run.id}
                onClick={() => onSelectRun(run.id)}
                className="cursor-pointer border-b hover:bg-gray-50"
              >
                <td className="px-3 py-2">
                  <StatusBadge status={run.status} />
                </td>
                <td className="px-3 py-2">{run.workflowId}</td>
                <td className="px-3 py-2 font-mono text-xs" title={run.id}>
                  {shortId(run.id)}
                </td>
                <td className="px-3 py-2 text-gray-600">{resourceId || '—'}</td>
                <td className="px-3 py-2 text-gray-600">{timeAgo(run.createdAt)}</td>
                <td className="px-3 py-2 text-gray-600">{durationLabel(run)}</td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Run test to verify it passes** — `cd packages/ui && npx vitest run src/components/runs-table.test.tsx` → PASS.
- [ ] **Step 5: Lint + type-check** — `npx biome check --write src/components/runs-table.ts*` then `npx biome check src/components/runs-table.ts*` (no diagnostics) and `npx tsc --noEmit -p .` (clean).
- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/runs-table.tsx packages/ui/src/components/runs-table.test.tsx
git commit -m "feat(ui): add RunsTable component"
```

---

### Task 2: `Pagination` (presentational)

**Files:**
- Create: `packages/ui/src/components/pagination.tsx`
- Test: `packages/ui/src/components/pagination.test.tsx`

**Interfaces:**
- Produces: `type PaginationProps = { hasPrev: boolean; hasNext: boolean; onPrev: () => void; onNext: () => void; isFetching?: boolean; className?: string }`; `function Pagination(props): JSX.Element`. Two buttons; Prev disabled when `!hasPrev`, Next disabled when `!hasNext`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/ui/src/components/pagination.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Pagination } from './pagination';

describe('Pagination', () => {
  it('disables Prev when hasPrev is false and Next when hasNext is false', () => {
    render(<Pagination hasPrev={false} hasNext={false} onPrev={() => {}} onNext={() => {}} />);
    expect(screen.getByRole('button', { name: /prev/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('fires onPrev/onNext when enabled buttons are clicked', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<Pagination hasPrev hasNext onPrev={onPrev} onNext={onNext} />);
    fireEvent.click(screen.getByRole('button', { name: /prev/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(onPrev).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/components/pagination.test.tsx` → FAIL (missing module).
- [ ] **Step 3: Write minimal implementation**

```tsx
// packages/ui/src/components/pagination.tsx
'use client';

import { cn } from '../lib/cn';

export type PaginationProps = {
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  isFetching?: boolean;
  className?: string;
};

export function Pagination({ hasPrev, hasNext, onPrev, onNext, isFetching, className }: PaginationProps) {
  const btn =
    'rounded border px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 hover:bg-gray-50';
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <button type="button" className={btn} onClick={onPrev} disabled={!hasPrev || isFetching}>
        ‹ Prev
      </button>
      <button type="button" className={btn} onClick={onNext} disabled={!hasNext || isFetching}>
        Next ›
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes** — PASS.
- [ ] **Step 5: Lint + type-check** — biome (write + check, no diagnostics) + `tsc --noEmit -p .` clean.
- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/pagination.tsx packages/ui/src/components/pagination.test.tsx
git commit -m "feat(ui): add Pagination component"
```

---

### Task 3: `RunDetail` (connected detail page)

**Files:**
- Create: `packages/ui/src/components/run-detail/run-detail.tsx`
- Test: `packages/ui/src/components/run-detail/run-detail.test.tsx`

**Interfaces:**
- Produces: `type RunDetailProps = { runId: string; onBack?: () => void; className?: string }`; `function RunDetail(props): JSX.Element`.
- Behavior: `const { data: run, isLoading, error } = useWorkflowRun(runId)`. While loading, render "Loading…"; on error, render an error message. When loaded: `RunDetailHeader` (with `onBack`), an **action bar**, `StepTimeline`, and `JsonViewer` for input / output / error.
- **Action bar** (uses the mutation hooks): Cancel (enabled when `!isTerminalStatus(run.status)`), Pause (enabled when `run.status === 'running'`), Resume (enabled when `run.status === 'paused'`), Fast-forward + Trigger (enabled when `!isTerminalStatus(run.status)`). Each button calls the matching mutation `.mutate({ id: runId })` (Trigger uses `{ id: runId, eventName: 'resume' }` as a minimal default — a fuller event form is out of scope for this task). Buttons are `disabled` while their mutation `isPending`. The server returns 409 for illegal transitions, so optimistic gating is safe.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/ui/src/components/run-detail/run-detail.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowRun, WorkflowRunsClient } from '../../client';
import { WorkflowRunsProvider } from '../../provider';
import { RunDetail } from './run-detail';

function makeClient(run: Partial<WorkflowRun>): WorkflowRunsClient {
  const full = { id: 'run_1', workflowId: 'wf', status: 'running', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), timeline: {}, ...run } as unknown as WorkflowRun;
  return {
    listRuns: vi.fn(),
    getRun: vi.fn().mockResolvedValue(full),
    cancelRun: vi.fn().mockResolvedValue(full),
    pauseRun: vi.fn().mockResolvedValue(full),
    resumeRun: vi.fn().mockResolvedValue(full),
    fastForwardRun: vi.fn().mockResolvedValue(full),
    triggerEvent: vi.fn().mockResolvedValue(full),
  };
}

function wrap(client: WorkflowRunsClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <WorkflowRunsProvider client={client} pollIntervalMs={0}>
        {children}
      </WorkflowRunsProvider>
    </QueryClientProvider>
  );
}

describe('RunDetail', () => {
  it('loads and shows the run, then cancels via the client', async () => {
    const client = makeClient({ status: 'running' });
    render(<RunDetail runId="run_1" />, { wrapper: wrap(client) });
    await waitFor(() => expect(screen.getByRole('button', { name: /cancel/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(client.cancelRun).toHaveBeenCalledWith('run_1'));
  });

  it('disables Resume for a running run and enables Pause', async () => {
    const client = makeClient({ status: 'running' });
    render(<RunDetail runId="run_1" />, { wrapper: wrap(client) });
    await waitFor(() => expect(screen.getByRole('button', { name: /pause/i })).toBeEnabled());
    expect(screen.getByRole('button', { name: /resume/i })).toBeDisabled();
  });

  it('disables all actions for a terminal (completed) run', async () => {
    const client = makeClient({ status: 'completed' });
    render(<RunDetail runId="run_1" />, { wrapper: wrap(client) });
    await waitFor(() => expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled());
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/components/run-detail/run-detail.test.tsx` → FAIL (missing module).
- [ ] **Step 3: Write minimal implementation**

```tsx
// packages/ui/src/components/run-detail/run-detail.tsx
'use client';

import {
  useCancelRun,
  useFastForwardRun,
  usePauseRun,
  useResumeRun,
  useTriggerEvent,
} from '../../hooks/use-run-mutations';
import { useWorkflowRun } from '../../hooks/use-workflow-run';
import { cn } from '../../lib/cn';
import { isTerminalStatus } from '../../lib/duration';
import { JsonViewer } from './json-viewer';
import { RunDetailHeader } from './run-detail-header';
import { StepTimeline } from './step-timeline';

export type RunDetailProps = {
  runId: string;
  onBack?: () => void;
  className?: string;
};

const actionBtn =
  'rounded border px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 hover:bg-gray-50';

export function RunDetail({ runId, onBack, className }: RunDetailProps) {
  const { data: run, isLoading, error } = useWorkflowRun(runId);
  const cancel = useCancelRun();
  const pause = usePauseRun();
  const resume = useResumeRun();
  const fastForward = useFastForwardRun();
  const trigger = useTriggerEvent();

  if (isLoading) return <div className={cn('p-6 text-gray-500', className)}>Loading…</div>;
  if (error || !run) {
    return (
      <div className={cn('p-6 text-red-600', className)}>
        Failed to load run.{' '}
        {onBack && (
          <button type="button" className="underline" onClick={onBack}>
            Back
          </button>
        )}
      </div>
    );
  }

  const terminal = isTerminalStatus(run.status);
  const output = (run as unknown as { output?: unknown }).output;
  const runError = (run as unknown as { error?: unknown }).error;

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <RunDetailHeader run={run} onBack={onBack} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={actionBtn}
          disabled={terminal || cancel.isPending}
          onClick={() => cancel.mutate({ id: runId })}
        >
          Cancel
        </button>
        <button
          type="button"
          className={actionBtn}
          disabled={run.status !== 'running' || pause.isPending}
          onClick={() => pause.mutate({ id: runId })}
        >
          Pause
        </button>
        <button
          type="button"
          className={actionBtn}
          disabled={run.status !== 'paused' || resume.isPending}
          onClick={() => resume.mutate({ id: runId })}
        >
          Resume
        </button>
        <button
          type="button"
          className={actionBtn}
          disabled={terminal || fastForward.isPending}
          onClick={() => fastForward.mutate({ id: runId })}
        >
          Fast-forward
        </button>
        <button
          type="button"
          className={actionBtn}
          disabled={terminal || trigger.isPending}
          onClick={() => trigger.mutate({ id: runId, eventName: 'resume' })}
        >
          Trigger
        </button>
      </div>
      <StepTimeline run={run} />
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="mb-1 text-xs font-medium uppercase text-gray-500">Input</h3>
          <JsonViewer value={(run as unknown as { input?: unknown }).input} />
        </div>
        {output != null && (
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase text-gray-500">Output</h3>
            <JsonViewer value={output} />
          </div>
        )}
        {runError != null && (
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase text-red-500">Error</h3>
            <JsonViewer value={runError} />
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes** — PASS (3 tests).
- [ ] **Step 5: Lint + type-check** — biome (write + check) + `tsc --noEmit -p .` clean.
- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/run-detail/run-detail.tsx packages/ui/src/components/run-detail/run-detail.test.tsx
git commit -m "feat(ui): add RunDetail connected component with action bar"
```

---

### Task 4: `WorkflowRunsDashboard` (self-contained top-level)

**Files:**
- Create: `packages/ui/src/components/workflow-runs-dashboard.tsx`
- Test: `packages/ui/src/components/workflow-runs-dashboard.test.tsx`

**Interfaces:**
- Produces:
  - `type WorkflowRunsDashboardProps = ({ client: WorkflowRunsClient } | { baseUrl: string }) & { pollIntervalMs?: number; selectedRunId?: string | null; onSelectRun?: (id: string | null) => void; className?: string }`
  - `function WorkflowRunsDashboard(props): JSX.Element`
- Behavior: builds a `WorkflowRunsClient` (`'client' in props ? props.client : createFetchClient({ baseUrl: props.baseUrl })`, memoized), creates a `QueryClient` once (`useState(() => new QueryClient())`), and wraps an inner component in `QueryClientProvider` + `WorkflowRunsProvider`. The inner component:
  - `useRunFilters()` → `serverParams`; `useWorkflowRuns(serverParams)`.
  - A second unfiltered `useWorkflowRuns({ limit: 100 })` to derive `workflowIds` = distinct `run.workflowId`, sorted, for the `FilterBar` dropdown.
  - Applies `applyClientFilters` + `sortRuns` to the page items using `filters`.
  - Manages selection: uncontrolled `useState<string | null>(null)`, unless `selectedRunId` prop is provided (controlled). `select(id)` updates internal state and calls `onSelectRun?.(id)`.
  - When a run is selected → render `<RunDetail runId={selected} onBack={() => select(null)} />`. Otherwise render `FilterBar` + `LiveIndicator` (toggles a local `live` boolean that sets `pollIntervalMs` — for this task, wire `LiveIndicator` `isLive`/`isFetching`/`onToggle` to the runs query's `isFetching` and a local live state; the provider `pollIntervalMs` prop drives polling) + `RunsTable` + `Pagination`.
  - Pagination: Next → `setFilters({ startingAfter: data.nextCursor ?? undefined, endingBefore: undefined })`; Prev → `setFilters({ endingBefore: data.prevCursor ?? undefined, startingAfter: undefined })`. `hasNext = !!data?.hasMore`, `hasPrev = !!data?.hasPrev`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/ui/src/components/workflow-runs-dashboard.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowRun, WorkflowRunsClient } from '../client';
import { WorkflowRunsDashboard } from './workflow-runs-dashboard';

const mkRun = (over: Partial<WorkflowRun> = {}): WorkflowRun =>
  ({
    id: 'run_1',
    workflowId: 'ingest',
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeline: {},
    ...over,
  }) as unknown as WorkflowRun;

function makeClient(): WorkflowRunsClient {
  return {
    listRuns: vi.fn().mockResolvedValue({
      items: [mkRun(), mkRun({ id: 'run_2', workflowId: 'email', status: 'completed' })],
      nextCursor: null,
      prevCursor: null,
      hasMore: false,
      hasPrev: false,
    }),
    getRun: vi.fn().mockResolvedValue(mkRun()),
    cancelRun: vi.fn(),
    pauseRun: vi.fn(),
    resumeRun: vi.fn(),
    fastForwardRun: vi.fn(),
    triggerEvent: vi.fn(),
  };
}

describe('WorkflowRunsDashboard', () => {
  it('renders the runs list from the client', async () => {
    render(<WorkflowRunsDashboard client={makeClient()} pollIntervalMs={0} />);
    await waitFor(() => expect(screen.getByText('ingest')).toBeInTheDocument());
    expect(screen.getByText('email')).toBeInTheDocument();
  });

  it('navigates to the detail page when a row is clicked and back again', async () => {
    const client = makeClient();
    render(<WorkflowRunsDashboard client={client} pollIntervalMs={0} />);
    await waitFor(() => expect(screen.getByText('ingest')).toBeInTheDocument());
    fireEvent.click(screen.getByText('ingest'));
    await waitFor(() => expect(client.getRun).toHaveBeenCalledWith('run_1'));
    await waitFor(() => expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    await waitFor(() => expect(screen.getByText('email')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/components/workflow-runs-dashboard.test.tsx` → FAIL (missing module).
- [ ] **Step 3: Write minimal implementation**

```tsx
// packages/ui/src/components/workflow-runs-dashboard.tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { type WorkflowRunsClient, createFetchClient } from '../client';
import { useRunFilters } from '../hooks/use-run-filters';
import { useWorkflowRuns } from '../hooks/use-workflow-runs';
import { applyClientFilters, sortRuns } from '../lib/filters';
import { cn } from '../lib/cn';
import { WorkflowRunsProvider } from '../provider';
import { FilterBar } from './filter-bar/filter-bar';
import { LiveIndicator } from './live-indicator';
import { Pagination } from './pagination';
import { RunDetail } from './run-detail/run-detail';
import { RunsTable } from './runs-table';

type SelectionProps = {
  selectedRunId?: string | null;
  onSelectRun?: (id: string | null) => void;
  className?: string;
};

export type WorkflowRunsDashboardProps = (
  | { client: WorkflowRunsClient; baseUrl?: never }
  | { baseUrl: string; client?: never }
) & { pollIntervalMs?: number } & SelectionProps;

export function WorkflowRunsDashboard(props: WorkflowRunsDashboardProps) {
  const client = useMemo(
    () => ('client' in props && props.client ? props.client : createFetchClient({ baseUrl: props.baseUrl as string })),
    // biome-ignore lint/correctness/useExhaustiveDependencies: client/baseUrl are stable per mount
    [],
  );
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const [live, setLive] = useState(true);
  const pollIntervalMs = props.pollIntervalMs ?? (live ? 5000 : 0);

  return (
    <QueryClientProvider client={qc}>
      <WorkflowRunsProvider client={client} pollIntervalMs={pollIntervalMs}>
        <DashboardInner {...props} live={live} onToggleLive={() => setLive((v) => !v)} />
      </WorkflowRunsProvider>
    </QueryClientProvider>
  );
}

function DashboardInner({
  selectedRunId,
  onSelectRun,
  className,
  live,
  onToggleLive,
}: SelectionProps & { live: boolean; onToggleLive: () => void }) {
  const { filters, setFilters, clearFilters, hasActiveFilters, serverParams } = useRunFilters();
  const runsQuery = useWorkflowRuns(serverParams);
  const workflowsQuery = useWorkflowRuns({ limit: 100 });

  const [internalSelected, setInternalSelected] = useState<string | null>(null);
  const selected = selectedRunId !== undefined ? selectedRunId : internalSelected;
  const select = (id: string | null) => {
    if (selectedRunId === undefined) setInternalSelected(id);
    onSelectRun?.(id);
  };

  const workflowIds = useMemo(() => {
    const ids = new Set((workflowsQuery.data?.items ?? []).map((r) => r.workflowId));
    return [...ids].sort();
  }, [workflowsQuery.data]);

  const rows = useMemo(() => {
    const items = runsQuery.data?.items ?? [];
    const clientFiltered = applyClientFilters(items, {
      from: filters.from,
      to: filters.to,
      minDuration: filters.minDuration,
      maxDuration: filters.maxDuration,
      search: filters.search,
    });
    return sortRuns(clientFiltered, filters.sort, filters.dir);
  }, [runsQuery.data, filters]);

  if (selected) {
    return (
      <div className={cn('p-4', className)}>
        <RunDetail runId={selected} onBack={() => select(null)} />
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-3 p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <FilterBar
          filters={filters}
          hasActiveFilters={hasActiveFilters}
          workflowIds={workflowIds}
          onFiltersChange={setFilters}
          onClear={clearFilters}
        />
        <LiveIndicator isLive={live} isFetching={runsQuery.isFetching} onToggle={onToggleLive} />
      </div>
      <RunsTable runs={rows} onSelectRun={select} isLoading={runsQuery.isLoading} />
      <Pagination
        hasPrev={!!runsQuery.data?.hasPrev}
        hasNext={!!runsQuery.data?.hasMore}
        isFetching={runsQuery.isFetching}
        onPrev={() =>
          setFilters({ endingBefore: runsQuery.data?.prevCursor ?? undefined, startingAfter: undefined })
        }
        onNext={() =>
          setFilters({ startingAfter: runsQuery.data?.nextCursor ?? undefined, endingBefore: undefined })
        }
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes** — PASS (2 tests). If the `useMemo` biome-ignore comment triggers a lint error about the directive, adjust to the exact Biome rule name reported.
- [ ] **Step 5: Lint + type-check** — `npx biome check --write` on the two files, then `npx biome check` (no diagnostics) and `npx tsc --noEmit -p .` (clean).
- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/workflow-runs-dashboard.tsx packages/ui/src/components/workflow-runs-dashboard.test.tsx
git commit -m "feat(ui): add self-contained WorkflowRunsDashboard (list -> detail)"
```

---

### Task 5: Public API barrel (`index.ts`)

**Files:**
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/index.test.ts`

**Interfaces:**
- `index.ts` re-exports the full public surface: the dashboard + all components, all hooks (queries + mutations), the provider + context value type, the client (`createFetchClient` + types), `useRunFilters`/`RunFilters`, the Tailwind preset is already a separate export. Export components and their prop types.

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui/src/index.test.ts
import { describe, expect, it } from 'vitest';
import * as ui from './index';

describe('public API', () => {
  it('exports the dashboard, components, provider, client factory, and hooks', () => {
    for (const name of [
      'WorkflowRunsDashboard',
      'RunsTable',
      'Pagination',
      'RunDetail',
      'StatusBadge',
      'WorkflowRunsProvider',
      'createFetchClient',
      'useWorkflowRuns',
      'useWorkflowRun',
      'useRunFilters',
      'useCancelRun',
      'usePauseRun',
      'useResumeRun',
      'useFastForwardRun',
      'useTriggerEvent',
    ]) {
      expect(ui[name as keyof typeof ui], `missing export: ${name}`).toBeTypeOf('function');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/index.test.ts` → FAIL (empty `export {}`).
- [ ] **Step 3: Write minimal implementation** — replace the body of `packages/ui/src/index.ts` (currently `export {};`) with:

```ts
// Provider + context
export { WorkflowRunsProvider, type WorkflowRunsProviderProps } from './provider';
export { WorkflowRunsContext, type WorkflowRunsContextValue } from './context';

// Client
export {
  createFetchClient,
  type CreateFetchClientOptions,
  type FastForwardBody,
  type ListRunsParams,
  type ListRunsResult,
  type TriggerEventBody,
  type WorkflowRun,
  type WorkflowRunStatus,
  type WorkflowRunsClient,
} from './client';

// Hooks (queries + mutations + filters)
export { useWorkflowRuns } from './hooks/use-workflow-runs';
export { useWorkflowRun } from './hooks/use-workflow-run';
export { useWorkflowRunsClient } from './hooks/use-workflow-runs-client';
export { type RunFilters, useRunFilters } from './hooks/use-run-filters';
export {
  useCancelRun,
  useFastForwardRun,
  usePauseRun,
  useResumeRun,
  useTriggerEvent,
} from './hooks/use-run-mutations';

// Components
export { WorkflowRunsDashboard, type WorkflowRunsDashboardProps } from './components/workflow-runs-dashboard';
export { RunsTable, type RunsTableProps } from './components/runs-table';
export { Pagination, type PaginationProps } from './components/pagination';
export { StatusBadge, type StatusBadgeProps } from './components/status-badge';
export { LiveIndicator, type LiveIndicatorProps } from './components/live-indicator';
export { FilterBar, type FilterBarProps } from './components/filter-bar/filter-bar';
export { RunDetail, type RunDetailProps } from './components/run-detail/run-detail';
export { RunDetailHeader, type RunDetailHeaderProps } from './components/run-detail/run-detail-header';
export { StepTimeline, type StepTimelineProps } from './components/run-detail/step-timeline';
export { JsonViewer, type JsonViewerProps } from './components/run-detail/json-viewer';
```

If any named export above does not exist under that exact name (e.g. a type not exported by its module), open the source module and either export it there or drop it from this barrel — the barrel must compile. `tsc --noEmit` in Step 5 is the gate.

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run src/index.test.ts` → PASS.
- [ ] **Step 5: Lint, type-check, FULL suite** —
```bash
cd packages/ui
npx biome check --write src/index.ts src/index.test.ts
npx biome check src/index.ts src/index.test.ts   # no diagnostics
npx tsc --noEmit -p .                             # clean (proves every re-export resolves)
npx vitest run                                    # full package suite passes
```
- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/index.ts packages/ui/src/index.test.ts
git commit -m "feat(ui): fill public API barrel (dashboard, components, hooks, client)"
```

---

## Self-Review

- **Spec coverage:** `RunsTable` (T1), `Pagination` (T2), `RunDetail` + action bar gated by status (T3), self-contained `WorkflowRunsDashboard` with list→detail navigation + filters + pagination + live toggle (T4), public `index.ts` surface incl. headless hooks (T5). ✓
- **Layout decision honored:** list → detail *page* (Dashboard swaps views on `selected`), not split-pane/drawer. ✓
- **Type consistency:** component/prop names (`RunsTable`/`RunsTableProps`, `Pagination`/`PaginationProps`, `RunDetail`/`RunDetailProps`, `WorkflowRunsDashboard`/`WorkflowRunsDashboardProps`) consistent across tasks and the barrel; hook + client names match the already-built modules.
- **Known simplifications (acceptable for this phase, ledger as deferred):** Trigger uses a fixed `eventName: 'resume'` default (no event-name form yet); `workflowIds` come from a second `useWorkflowRuns({ limit: 100 })` query; action gating is optimistic with the server's 409 as the safety net.
- **Placeholders:** none — every step has runnable code and an exact command. Where a Biome rule name or an export name must be confirmed against the live tree, the step says so and `tsc`/`biome` are the gates.
```
