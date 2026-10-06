'use client';

import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { useWorkflowRunsClient } from './use-workflow-runs-client';

export function useWorkflowIds(): UseQueryResult<string[]> {
  const { client, pollIntervalMs } = useWorkflowRunsClient();
  return useQuery<string[]>({
    queryKey: ['pgw', 'workflows'],
    queryFn: () => client.listWorkflowIds(),
    refetchInterval: pollIntervalMs > 0 ? pollIntervalMs : false,
  });
}
