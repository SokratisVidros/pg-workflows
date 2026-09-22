import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowRunsClient } from '../client';
import { WorkflowRunsProvider } from '../provider';
import { useWorkflowRunStats } from './use-workflow-run-stats';

function makeClient(): WorkflowRunsClient {
  return {
    listRuns: vi.fn(),
    getRun: vi.fn(),
    getStats: vi.fn().mockResolvedValue({
      pending: 0,
      running: 2,
      paused: 0,
      completed: 5,
      failed: 1,
      cancelled: 0,
    }),
    cancelRun: vi.fn(),
    pauseRun: vi.fn(),
    resumeRun: vi.fn(),
    fastForwardRun: vi.fn(),
    triggerEvent: vi.fn(),
  };
}

describe('useWorkflowRunStats', () => {
  it('returns counts from client.getStats and forwards workflowId', async () => {
    const client = makeClient();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    function Probe() {
      const { data, isLoading } = useWorkflowRunStats({ workflowId: 'ingest' });
      if (isLoading) return <div>loading</div>;
      return <div data-testid="running">{data?.running}</div>;
    }

    render(
      <QueryClientProvider client={qc}>
        <WorkflowRunsProvider client={client} pollIntervalMs={0}>
          <Probe />
        </WorkflowRunsProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('running').textContent).toBe('2'));
    expect(client.getStats).toHaveBeenCalledWith({ workflowId: 'ingest' });
  });
});
