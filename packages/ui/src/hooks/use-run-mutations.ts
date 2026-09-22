'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { WorkflowRun, WorkflowRunsClient } from '../client';
import { useWorkflowRunsClient } from './use-workflow-runs-client';

function useInvalidateRun() {
  const qc = useQueryClient();
  return (id: string) => {
    qc.invalidateQueries({ queryKey: ['pgw', 'run', id] });
    qc.invalidateQueries({ queryKey: ['pgw', 'runs'] });
  };
}

function useRunAction<TVars extends { id: string }>(
  action: (client: WorkflowRunsClient, vars: TVars) => Promise<WorkflowRun>,
) {
  const { client } = useWorkflowRunsClient();
  const invalidate = useInvalidateRun();
  return useMutation<WorkflowRun, Error, TVars>({
    mutationFn: (vars) => action(client, vars),
    onSuccess: (_run, { id }) => invalidate(id),
  });
}

export function useRunActions() {
  const cancel = useRunAction((client, { id }) => client.cancelRun(id));
  const pause = useRunAction((client, { id }) => client.pauseRun(id));
  const resume = useRunAction((client, { id }) => client.resumeRun(id));
  const fastForward = useRunAction<{ id: string; data?: Record<string, unknown> }>(
    (client, { id, data }) => client.fastForwardRun(id, { data }),
  );
  const trigger = useRunAction<{ id: string; eventName: string; data?: Record<string, unknown> }>(
    (client, { id, eventName, data }) => client.triggerEvent(id, { eventName, data }),
  );
  return { cancel, pause, resume, fastForward, trigger };
}
