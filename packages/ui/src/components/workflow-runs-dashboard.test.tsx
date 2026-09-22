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

const stats = {
  pending: 0,
  running: 1,
  paused: 0,
  completed: 1,
  failed: 0,
  cancelled: 0,
};

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
    getStats: vi.fn().mockResolvedValue(stats),
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

  it('uses themeable tokens, not hardcoded palette colors', async () => {
    const { container } = render(
      <WorkflowRunsDashboard client={makeClient()} pollIntervalMs={0} />,
    );
    await waitFor(() => expect(screen.getByText('ingest')).toBeInTheDocument());
    expect(container.innerHTML).not.toMatch(
      /\b(?:text|bg|border|hover:bg)-(?:gray|red|blue|green|yellow|zinc|slate|neutral)-/,
    );
  });

  it('replaces the runs table with a full-screen detail view and returns on back', async () => {
    const client = makeClient();
    render(<WorkflowRunsDashboard client={client} pollIntervalMs={0} />);
    await waitFor(() => expect(screen.getByText('ingest')).toBeInTheDocument());
    fireEvent.click(screen.getByText('ingest'));
    await waitFor(() => expect(client.getRun).toHaveBeenCalledWith('run_1'));
    await waitFor(() => expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument());
    expect(screen.queryByText('email')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search runs...')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^live$/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    await waitFor(() => expect(screen.getByText('email')).toBeInTheDocument());
    expect(screen.getByPlaceholderText('Search runs...')).toBeInTheDocument();
  });

  it('resets pagination cursors when a filter changes', async () => {
    // hasMore/nextCursor are populated so pagination actually sets a cursor,
    // proving the subsequent filter change clears it rather than merging over it.
    const client: WorkflowRunsClient = {
      listRuns: vi.fn().mockResolvedValue({
        items: [mkRun(), mkRun({ id: 'run_2', workflowId: 'email', status: 'completed' })],
        nextCursor: 'cursor-123',
        prevCursor: null,
        hasMore: true,
        hasPrev: false,
      }),
      getRun: vi.fn().mockResolvedValue(mkRun()),
      getStats: vi.fn().mockResolvedValue(stats),
      cancelRun: vi.fn(),
      pauseRun: vi.fn(),
      resumeRun: vi.fn(),
      fastForwardRun: vi.fn(),
      triggerEvent: vi.fn(),
    };
    const listRuns = client.listRuns as ReturnType<typeof vi.fn>;
    const runsCalls = () => listRuns.mock.calls.map((c) => c[0]);

    render(<WorkflowRunsDashboard client={client} pollIntervalMs={0} />);
    await waitFor(() => expect(screen.getByText('ingest')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => {
      const last = runsCalls().at(-1);
      expect(last).toMatchObject({ startingAfter: 'cursor-123', endingBefore: undefined });
    });

    // Now change a filter (search) — the stale startingAfter cursor from the
    // page above must not leak into the next request.
    fireEvent.change(screen.getByPlaceholderText('Search runs...'), {
      target: { value: 'foo' },
    });

    await waitFor(() => {
      const last = runsCalls().at(-1);
      expect(last).toMatchObject({ startingAfter: undefined, endingBefore: undefined });
    });
  });

  it('shows an error banner instead of silently rendering an empty list', async () => {
    const client: WorkflowRunsClient = {
      listRuns: vi.fn().mockRejectedValue(new Error('boom')),
      getRun: vi.fn().mockResolvedValue(mkRun()),
      getStats: vi.fn().mockResolvedValue(stats),
      cancelRun: vi.fn(),
      pauseRun: vi.fn(),
      resumeRun: vi.fn(),
      fastForwardRun: vi.fn(),
      triggerEvent: vi.fn(),
    };
    render(<WorkflowRunsDashboard client={client} pollIntervalMs={0} />);
    await waitFor(() => expect(screen.getByText('Failed to load runs.')).toBeInTheDocument());
    expect(screen.queryByText('No runs')).not.toBeInTheDocument();
  });

  it('renders LiveToggle above the status summary, outside the filter bar', async () => {
    const { container } = render(
      <WorkflowRunsDashboard client={makeClient()} pollIntervalMs={0} />,
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /1\s*running/i })).toBeInTheDocument(),
    );

    const live = screen.getByRole('button', { name: /^live$/i });
    const summary = screen.getByRole('button', { name: /1\s*running/i });
    expect(live.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('.pgw-filters')?.contains(live)).toBe(false);
  });

  it('fetches the runs page once and loads status counts via getStats', async () => {
    const client = makeClient();
    render(<WorkflowRunsDashboard client={client} pollIntervalMs={0} />);
    await waitFor(() => expect(screen.getByText('ingest')).toBeInTheDocument());
    expect(client.listRuns).toHaveBeenCalledTimes(1);
    expect(client.listRuns).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }));
    expect(client.getStats).toHaveBeenCalledTimes(1);
    expect(client.getStats).toHaveBeenCalledWith({ workflowId: undefined });
  });

  it('filters the runs list by status without sending statuses to getStats', async () => {
    const client = makeClient();
    render(<WorkflowRunsDashboard client={client} pollIntervalMs={0} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /1\s*completed/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /1\s*completed/i }));

    await waitFor(() => {
      const last = (client.listRuns as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
      expect(last).toMatchObject({ limit: 20, statuses: ['completed'] });
    });
    expect(client.listRuns).toHaveBeenCalledTimes(2);
    for (const [params] of (client.getStats as ReturnType<typeof vi.fn>).mock.calls) {
      expect(params).toEqual({ workflowId: undefined });
    }
  });
});
