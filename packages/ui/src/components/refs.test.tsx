import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { createRef, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowRun, WorkflowRunsClient } from '../client';
import { WorkflowRunsProvider } from '../provider';
import {
  DateRangeFilter,
  DurationFilter,
  FilterBar,
  JsonViewer,
  LiveToggle,
  Pagination,
  RunDetail,
  RunDetailHeader,
  RunProgress,
  RunsTable,
  SearchFilter,
  StatusBadge,
  StatusFilter,
  StatusSummary,
  StepTimeline,
  WorkflowIdFilter,
  WorkflowRunsDashboard,
} from './index';

const run = {
  id: 'run_a',
  workflowId: 'demo',
  status: 'completed',
  createdAt: '2026-06-17T12:00:00Z',
  completedAt: '2026-06-17T12:00:10Z',
  pausedAt: null,
  resourceId: null,
  currentStepId: '',
  input: {},
  timeline: {},
} as unknown as WorkflowRun;

const runWithSteps = {
  ...run,
  timeline: {
    'step-a': { output: { x: 1 }, timestamp: '2026-06-17T12:00:01Z' },
  },
  currentStepId: 'step-b',
  status: 'running',
} as unknown as WorkflowRun;

function makeClient(full: WorkflowRun = run): WorkflowRunsClient {
  return {
    listRuns: vi.fn().mockResolvedValue({
      items: [full],
      nextCursor: null,
      prevCursor: null,
      hasMore: false,
      hasPrev: false,
    }),
    getRun: vi.fn().mockResolvedValue(full),
    cancelRun: vi.fn(),
    pauseRun: vi.fn(),
    resumeRun: vi.fn(),
    fastForwardRun: vi.fn(),
    triggerEvent: vi.fn(),
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

describe('ref forwarding', () => {
  it('forwards a ref to StatusBadge’s root span', () => {
    const ref = createRef<HTMLSpanElement>();
    render(<StatusBadge ref={ref} status="completed" />);
    expect(ref.current).toBeInstanceOf(HTMLSpanElement);
  });

  it('forwards a ref to LiveToggle’s button', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<LiveToggle ref={ref} isLive isFetching={false} onToggle={() => {}} />);
    expect(ref.current?.tagName).toBe('BUTTON');
  });

  it('forwards a ref to JsonViewer in both the data and no-data branches', () => {
    const withData = createRef<HTMLDivElement>();
    render(<JsonViewer ref={withData} value={{ a: 1 }} />);
    expect(withData.current).toBeInstanceOf(HTMLDivElement);

    const noData = createRef<HTMLDivElement>();
    render(<JsonViewer ref={noData} value={undefined} />);
    expect(noData.current?.textContent).toBe('No data');
  });

  it('forwards a ref to RunDetailHeader’s header element', () => {
    const ref = createRef<HTMLElement>();
    render(<RunDetailHeader ref={ref} run={run} />);
    expect(ref.current?.tagName).toBe('HEADER');
  });

  it('forwards a ref to StepTimeline’s root', () => {
    const ref = createRef<HTMLDivElement>();
    render(<StepTimeline ref={ref} run={run} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('forwards a ref to FilterBar’s root and applies className', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <FilterBar
        ref={ref}
        className="custom-cls"
        filters={{ limit: 20, sort: 'createdAt', dir: 'desc' }}
        hasActiveFilters={false}
        workflowIds={[]}
        onFiltersChange={() => {}}
        onClear={() => {}}
      />,
    );
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current?.className).toContain('custom-cls');
  });

  it('forwards a ref to StatusFilter’s trigger', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<StatusFilter ref={ref} value={[]} onChange={() => {}} />);
    expect(ref.current?.tagName).toBe('BUTTON');
  });

  it('forwards a ref to DateRangeFilter’s trigger', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<DateRangeFilter ref={ref} onChange={() => {}} />);
    expect(ref.current?.tagName).toBe('BUTTON');
  });

  it('forwards a ref to DurationFilter’s trigger', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<DurationFilter ref={ref} onChange={() => {}} />);
    expect(ref.current?.tagName).toBe('BUTTON');
  });

  it('forwards a ref to SearchFilter’s root', () => {
    const ref = createRef<HTMLDivElement>();
    render(<SearchFilter ref={ref} onChange={() => {}} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('forwards a ref to WorkflowIdFilter’s trigger', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<WorkflowIdFilter ref={ref} options={['demo']} onChange={() => {}} />);
    expect(ref.current?.tagName).toBe('BUTTON');
  });

  it('forwards a ref to Pagination’s root', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <Pagination
        ref={ref}
        className="custom-cls"
        hasPrev={false}
        hasNext={false}
        onPrev={() => {}}
        onNext={() => {}}
      />,
    );
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current?.className).toContain('custom-cls');
  });

  it('forwards a ref to RunsTable’s table', () => {
    const ref = createRef<HTMLTableElement>();
    render(<RunsTable ref={ref} runs={[run]} onSelectRun={() => {}} />);
    expect(ref.current?.tagName).toBe('TABLE');
  });

  it('forwards a ref to StatusSummary’s root', () => {
    const ref = createRef<HTMLDivElement>();
    render(<StatusSummary ref={ref} runs={[run]} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('forwards a ref to RunProgress when steps exist', () => {
    const ref = createRef<HTMLDivElement>();
    render(<RunProgress ref={ref} run={runWithSteps} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('forwards a ref to RunDetail’s root after load', async () => {
    const ref = createRef<HTMLDivElement>();
    render(<RunDetail ref={ref} runId="run_a" />, { wrapper: wrap(makeClient()) });
    await waitFor(() => expect(ref.current).toBeInstanceOf(HTMLDivElement));
  });

  it('forwards a ref to WorkflowRunsDashboard’s root', async () => {
    const ref = createRef<HTMLDivElement>();
    render(<WorkflowRunsDashboard ref={ref} client={makeClient()} pollIntervalMs={0} />);
    await waitFor(() => expect(ref.current).toBeInstanceOf(HTMLDivElement));
    expect(ref.current?.className).toContain('pgw-root');
  });
});
