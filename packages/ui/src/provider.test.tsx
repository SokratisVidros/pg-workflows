import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { WorkflowRunsClient } from './client';
import { useWorkflowRunsClient } from './hooks/use-workflow-runs-client';
import { WorkflowRunsProvider } from './provider';

const stubClient: WorkflowRunsClient = {
  listRuns: async () => ({
    items: [],
    nextCursor: null,
    prevCursor: null,
    hasMore: false,
    hasPrev: false,
  }),
  getRun: async () => ({ id: 'x' }) as never,
};

function Probe() {
  const ctx = useWorkflowRunsClient();
  return <div data-testid="probe">{ctx.pollIntervalMs}</div>;
}

describe('WorkflowRunsProvider', () => {
  it('exposes client and pollIntervalMs to children', () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <WorkflowRunsProvider client={stubClient} pollIntervalMs={1234}>
          <Probe />
        </WorkflowRunsProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('1234');
  });

  it('defaults pollIntervalMs to 5000', () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <WorkflowRunsProvider client={stubClient}>
          <Probe />
        </WorkflowRunsProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('5000');
  });

  it('throws when used without provider', () => {
    expect(() => render(<Probe />)).toThrow(/WorkflowRunsProvider/);
  });
});
