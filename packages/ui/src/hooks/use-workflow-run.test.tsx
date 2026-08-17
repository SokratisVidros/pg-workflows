import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowRunsClient } from '../client';
import { WorkflowRunsProvider } from '../provider';
import { useWorkflowRun } from './use-workflow-run';

function makeClient(status: string): WorkflowRunsClient {
  return {
    listRuns: vi.fn(),
    getRun: vi.fn().mockResolvedValue({ id: 'run_x', status }),
    cancelRun: vi.fn(),
    pauseRun: vi.fn(),
    resumeRun: vi.fn(),
    fastForwardRun: vi.fn(),
    triggerEvent: vi.fn(),
  };
}

function withWrapper(client: WorkflowRunsClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={qc}>
        <WorkflowRunsProvider client={client} pollIntervalMs={1000}>
          {children}
        </WorkflowRunsProvider>
      </QueryClientProvider>
    );
  };
}

function Probe({ id }: { id: string }) {
  const { data } = useWorkflowRun(id);
  return <div data-testid="status">{data?.status}</div>;
}

describe('useWorkflowRun', () => {
  it('fetches a single run', async () => {
    const client = makeClient('running');
    render(<Probe id="run_x" />, { wrapper: withWrapper(client) });
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('running'));
  });

  it('returns terminal-status runs', async () => {
    const client = makeClient('completed');
    render(<Probe id="run_x" />, { wrapper: withWrapper(client) });
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('completed'));
    expect(client.getRun).toHaveBeenCalled();
  });
});
