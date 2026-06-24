import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowRunsProvider } from '../provider';
import { useWorkflowRuns } from './use-workflow-runs';
import type { WorkflowRunsClient } from '../client';

function makeClient(): WorkflowRunsClient {
  return {
    listRuns: vi.fn().mockResolvedValue({
      items: [{ id: 'run_1' }, { id: 'run_2' }],
      nextCursor: null, prevCursor: null, hasMore: false, hasPrev: false,
    }),
    getRun: vi.fn(),
  };
}

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <WorkflowRunsProvider client={makeClient()} pollIntervalMs={0}>
        {children}
      </WorkflowRunsProvider>
    </QueryClientProvider>
  );
}

function Probe() {
  const { data, isLoading } = useWorkflowRuns({ limit: 20 });
  if (isLoading) return <div>loading</div>;
  return <div data-testid="ids">{data?.items.map((r) => r.id).join(',')}</div>;
}

describe('useWorkflowRuns', () => {
  it('returns the list from the client', async () => {
    render(<Probe />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('ids').textContent).toBe('run_1,run_2'));
  });
});
