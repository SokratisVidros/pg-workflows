import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowRunsClient } from '../client';
import { WorkflowRunsProvider } from '../provider';
import {
  useCancelRun,
  useFastForwardRun,
  usePauseRun,
  useResumeRun,
  useTriggerEvent,
} from './use-run-mutations';

function makeClient(): WorkflowRunsClient {
  const run = { id: 'run_1', status: 'cancelled' } as never;
  return {
    listRuns: vi.fn(),
    getRun: vi.fn(),
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

describe('run mutation hooks', () => {
  it('useCancelRun calls client.cancelRun and invalidates run + runs queries', async () => {
    const { client, invalidate, wrapper } = setup();
    const { result } = renderHook(() => useCancelRun(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'run_1' });
    });
    expect(client.cancelRun).toHaveBeenCalledWith('run_1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['pgw', 'run', 'run_1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['pgw', 'runs'] });
  });

  it('usePauseRun and useResumeRun call their client methods', async () => {
    const { client, wrapper } = setup();
    const pause = renderHook(() => usePauseRun(), { wrapper });
    const resume = renderHook(() => useResumeRun(), { wrapper });
    await act(async () => {
      await pause.result.current.mutateAsync({ id: 'run_1' });
      await resume.result.current.mutateAsync({ id: 'run_1' });
    });
    expect(client.pauseRun).toHaveBeenCalledWith('run_1');
    expect(client.resumeRun).toHaveBeenCalledWith('run_1');
  });

  it('useFastForwardRun forwards optional data', async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useFastForwardRun(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'run_1', data: { k: 1 } });
    });
    expect(client.fastForwardRun).toHaveBeenCalledWith('run_1', { data: { k: 1 } });
  });

  it('useTriggerEvent forwards eventName + data', async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useTriggerEvent(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'run_1', eventName: 'go', data: { a: 1 } });
    });
    expect(client.triggerEvent).toHaveBeenCalledWith('run_1', { eventName: 'go', data: { a: 1 } });
  });
});
