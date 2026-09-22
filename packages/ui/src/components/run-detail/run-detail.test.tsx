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
    getStats: vi.fn(),
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
    const pause = await screen.findByRole('button', { name: /^pause$/i });
    const cancel = screen.getByRole('button', { name: /^cancel$/i });
    expect(pause).toBeEnabled();
    expect(screen.getByRole('button', { name: /^resume$/i })).toBeDisabled();
    expect(pause.parentElement).toBe(cancel.parentElement);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Run details' })).not.toBeInTheDocument();
  });

  it('disables all actions for a terminal (completed) run', async () => {
    const client = makeClient({ status: 'completed' });
    render(<RunDetail runId="run_1" />, { wrapper: wrap(client) });
    await waitFor(() => expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled());
  });

  it('reveals a step input/output via the StepTimeline expandable row on click', async () => {
    const client = makeClient({
      status: 'completed',
      timeline: {
        'step-a': {
          input: { userId: 42 },
          output: { greeting: 'hi' },
          timestamp: new Date().toISOString(),
        },
      },
    });
    render(<RunDetail runId="run_1" />, { wrapper: wrap(client) });
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /step-a/i }).length).toBeGreaterThan(0),
    );
    const [stepRow] = screen.getAllByRole('button', { name: /step-a/i });
    fireEvent.click(stepRow as HTMLElement);
    await waitFor(() => expect(screen.getByText(/"userId": 42/)).toBeInTheDocument());
    expect(screen.getByText(/"greeting": "hi"/)).toBeInTheDocument();
  });

  it('shows retries, priority, job, and error in the run details', async () => {
    const client = makeClient({
      status: 'failed',
      resourceId: 'tenant-emea',
      createdAt: '2026-06-17T12:00:00.000Z',
      completedAt: '2026-06-17T12:01:05.000Z',
      retryCount: 2,
      maxRetries: 5,
      priority: 100,
      jobId: 'job_1',
      error: 'boom',
    });
    render(<RunDetail runId="run_1" />, { wrapper: wrap(client) });
    await waitFor(() => expect(screen.getByText('Resource ID')).toBeInTheDocument());
    expect(screen.getByText('tenant-emea')).toBeInTheDocument();
    expect(screen.getByText('Retries')).toBeInTheDocument();
    expect(screen.getByText('2 / 5')).toBeInTheDocument();
    expect(screen.getByText('Priority')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
    expect(screen.getByText('Job')).toBeInTheDocument();
    expect(screen.getByText('job_1')).toBeInTheDocument();
    const errorHeading = screen.getByRole('heading', { name: 'Error' });
    const details = screen.getByRole('heading', { name: 'Details' });
    expect(
      errorHeading.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText(/boom/)).toBeInTheDocument();
    expect(screen.getAllByText('1m 5s').length).toBeGreaterThan(0);
  });

  it('shows an em dash for error, retries, priority, and job when they are absent', async () => {
    const client = makeClient({
      status: 'pending',
      retryCount: undefined,
      maxRetries: undefined,
      priority: undefined,
      jobId: null,
      error: null,
    });
    render(<RunDetail runId="run_1" />, { wrapper: wrap(client) });
    await waitFor(() => expect(screen.getByText('Retries')).toBeInTheDocument());
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Priority')).toBeInTheDocument();
    expect(screen.getByText('Job')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
  });

  it('always renders Input and Output sections, even when output is null', async () => {
    const client = makeClient({ status: 'running', input: { a: 1 }, output: null });
    render(<RunDetail runId="run_1" />, { wrapper: wrap(client) });
    await waitFor(() => expect(screen.getByRole('button', { name: /cancel/i })).toBeEnabled());
    expect(screen.getByRole('heading', { name: /input/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /output/i })).toBeInTheDocument();
  });

  it('shows an inline error message when an action mutation rejects', async () => {
    const client = makeClient({ status: 'running' });
    client.cancelRun = vi.fn().mockRejectedValue(new Error('network down'));
    render(<RunDetail runId="run_1" />, { wrapper: wrap(client) });
    await waitFor(() => expect(screen.getByRole('button', { name: /cancel/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.getByText(/network down/)).toBeInTheDocument());
  });

  it('shows a success confirmation when an action mutation resolves', async () => {
    const client = makeClient({ status: 'running' });
    render(<RunDetail runId="run_1" />, { wrapper: wrap(client) });
    await waitFor(() => expect(screen.getByRole('button', { name: /cancel/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(client.cancelRun).toHaveBeenCalledWith('run_1'));
    await waitFor(() => expect(screen.getByText(/cancelled/i)).toBeInTheDocument());
    expect(screen.queryByText(/network down/)).not.toBeInTheDocument();
  });

  it('does not use raw palette classes anywhere in the markup', async () => {
    const NO_RAW_PALETTE =
      /\b(?:text|bg|border|hover:bg)-(?:gray|red|blue|green|yellow|zinc|slate|neutral)-/;
    const client = makeClient({ status: 'running' });
    const { container } = render(<RunDetail runId="run_1" />, { wrapper: wrap(client) });
    await waitFor(() => expect(screen.getByRole('button', { name: /cancel/i })).toBeEnabled());
    expect(container.innerHTML).not.toMatch(NO_RAW_PALETTE);
  });
});
