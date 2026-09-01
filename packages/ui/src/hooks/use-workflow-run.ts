'use client';

import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import type { WorkflowRun } from '../client';
import { isTerminalStatus } from '../lib/duration';
import { useWorkflowRunsClient } from './use-workflow-runs-client';

export function useWorkflowRun(id: string): UseQueryResult<WorkflowRun> {
  const { client, pollIntervalMs } = useWorkflowRunsClient();
  return useQuery<WorkflowRun>({
    queryKey: ['pgw', 'run', id],
    queryFn: () => client.getRun(id),
    enabled: !!id,
    refetchInterval: (query) => {
      if (pollIntervalMs <= 0) return false;
      const run = query.state.data;
      if (run && isTerminalStatus(run.status)) return false;
      return pollIntervalMs;
    },
  });
}
