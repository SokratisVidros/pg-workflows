'use client';

import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import type { GetStatsParams, WorkflowRunStats } from '../client';
import { useWorkflowRunsClient } from './use-workflow-runs-client';

export function useWorkflowRunStats(params: GetStatsParams = {}): UseQueryResult<WorkflowRunStats> {
  const { client, pollIntervalMs } = useWorkflowRunsClient();
  return useQuery<WorkflowRunStats>({
    queryKey: ['pgw', 'runs', 'stats', params],
    queryFn: () => client.getStats(params),
    refetchInterval: pollIntervalMs > 0 ? pollIntervalMs : false,
    placeholderData: (prev) => prev,
  });
}
