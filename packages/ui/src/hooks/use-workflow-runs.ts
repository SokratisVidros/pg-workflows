'use client';

import { useQuery } from '@tanstack/react-query';
import { useWorkflowRunsClient } from './use-workflow-runs-client';
import type { ListRunsParams, ListRunsResult } from '../client';

export function useWorkflowRuns(params: ListRunsParams) {
  const { client, pollIntervalMs } = useWorkflowRunsClient();
  return useQuery<ListRunsResult>({
    queryKey: ['pgw', 'runs', params],
    queryFn: () => client.listRuns(params),
    refetchInterval: pollIntervalMs > 0 ? pollIntervalMs : false,
    placeholderData: (prev) => prev,
  });
}
