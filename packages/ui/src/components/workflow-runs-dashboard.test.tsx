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
      cancelRun: vi.fn(),
      pauseRun: vi.fn(),
      resumeRun: vi.fn(),
      fastForwardRun: vi.fn(),
      triggerEvent: vi.fn(),
    };
    const listRuns = client.listRuns as ReturnType<typeof vi.fn>;
    // The page-size (limit: 20) calls are the runs list query; a second query
    // (limit: 100) powers the workflow-id filter options — filter those out.
    const runsCalls = () => listRuns.mock.calls.map((c) => c[0]).filter((p) => p.limit === 20);

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
});
