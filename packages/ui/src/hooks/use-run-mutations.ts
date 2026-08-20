'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { WorkflowRun } from '../client';
import { useWorkflowRunsClient } from './use-workflow-runs-client';

function useInvalidateRun() {
  const qc = useQueryClient();
  return (id: string) => {
    qc.invalidateQueries({ queryKey: ['pgw', 'run', id] });
    qc.invalidateQueries({ queryKey: ['pgw', 'runs'] });
  };
}

export function useCancelRun() {
  const { client } = useWorkflowRunsClient();
  const invalidate = useInvalidateRun();
  return useMutation<WorkflowRun, Error, { id: string }>({
    mutationFn: ({ id }) => client.cancelRun(id),
    onSuccess: (_run, { id }) => invalidate(id),
  });
}

export function usePauseRun() {
  const { client } = useWorkflowRunsClient();
  const invalidate = useInvalidateRun();
  return useMutation<WorkflowRun, Error, { id: string }>({
    mutationFn: ({ id }) => client.pauseRun(id),
    onSuccess: (_run, { id }) => invalidate(id),
  });
}

export function useResumeRun() {
  const { client } = useWorkflowRunsClient();
  const invalidate = useInvalidateRun();
  return useMutation<WorkflowRun, Error, { id: string }>({
    mutationFn: ({ id }) => client.resumeRun(id),
    onSuccess: (_run, { id }) => invalidate(id),
  });
}

export function useFastForwardRun() {
  const { client } = useWorkflowRunsClient();
  const invalidate = useInvalidateRun();
  return useMutation<WorkflowRun, Error, { id: string; data?: Record<string, unknown> }>({
    mutationFn: ({ id, data }) => client.fastForwardRun(id, { data }),
    onSuccess: (_run, { id }) => invalidate(id),
  });
}

export function useTriggerEvent() {
  const { client } = useWorkflowRunsClient();
  const invalidate = useInvalidateRun();
  return useMutation<
    WorkflowRun,
    Error,
    { id: string; eventName: string; data?: Record<string, unknown> }
  >({
    mutationFn: ({ id, eventName, data }) => client.triggerEvent(id, { eventName, data }),
    onSuccess: (_run, { id }) => invalidate(id),
  });
}
