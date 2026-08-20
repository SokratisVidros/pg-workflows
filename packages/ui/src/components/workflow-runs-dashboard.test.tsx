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
