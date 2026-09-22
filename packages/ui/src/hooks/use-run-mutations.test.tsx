import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowRunsClient } from '../client';
import { WorkflowRunsProvider } from '../provider';
import { useRunActions } from './use-run-mutations';

function makeClient(): WorkflowRunsClient {
  const run = { id: 'run_1', status: 'cancelled' } as never;
  return {
    listRuns: vi.fn(),
    getRun: vi.fn(),
    getStats: vi.fn(),
    cancelRun: vi.fn().mockResolvedValue(run),
    pauseRun: vi.fn().mockResolvedValue(run),
    resumeRun: vi.fn().mockResolvedValue(run),
    fastForwardRun: vi.fn().mockResolvedValue(run),
    triggerEvent: vi.fn().mockResolvedValue(run),
  };
}

function setup() {
  const client = makeClient();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <WorkflowRunsProvider client={client} pollIntervalMs={0}>
        {children}
      </WorkflowRunsProvider>
    </QueryClientProvider>
  );
  return { client, invalidate, wrapper };
}

describe('useRunActions', () => {
  it('cancel calls client.cancelRun and invalidates run + runs queries', async () => {
    const { client, invalidate, wrapper } = setup();
    const { result } = renderHook(() => useRunActions(), { wrapper });
    await act(async () => {
      await result.current.cancel.mutateAsync({ id: 'run_1' });
    });
    expect(client.cancelRun).toHaveBeenCalledWith('run_1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['pgw', 'run', 'run_1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['pgw', 'runs'] });
  });

  it('pause and resume call their client methods', async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useRunActions(), { wrapper });
    await act(async () => {
      await result.current.pause.mutateAsync({ id: 'run_1' });
      await result.current.resume.mutateAsync({ id: 'run_1' });
    });
    expect(client.pauseRun).toHaveBeenCalledWith('run_1');
    expect(client.resumeRun).toHaveBeenCalledWith('run_1');
  });

  it('fastForward forwards optional data', async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useRunActions(), { wrapper });
    await act(async () => {
      await result.current.fastForward.mutateAsync({ id: 'run_1', data: { k: 1 } });
    });
    expect(client.fastForwardRun).toHaveBeenCalledWith('run_1', { data: { k: 1 } });
  });

  it('trigger forwards eventName + data', async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useRunActions(), { wrapper });
    await act(async () => {
      await result.current.trigger.mutateAsync({ id: 'run_1', eventName: 'go', data: { a: 1 } });
    });
    expect(client.triggerEvent).toHaveBeenCalledWith('run_1', { eventName: 'go', data: { a: 1 } });
  });
});
