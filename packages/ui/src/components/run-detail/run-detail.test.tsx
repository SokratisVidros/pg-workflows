import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowRun, WorkflowRunsClient } from '../../client';
import { WorkflowRunsProvider } from '../../provider';
import { RunDetail } from './run-detail';

function makeClient(run: Partial<WorkflowRun>): WorkflowRunsClient {
  const full = {
    id: 'run_1',
    workflowId: 'wf',
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeline: {},
    ...run,
  } as unknown as WorkflowRun;
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
