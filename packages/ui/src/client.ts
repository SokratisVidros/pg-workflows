import type { WorkflowRun } from 'pg-workflows/client';

export type { WorkflowRun };

// WorkflowRun.status is a string union, not the WorkflowStatus enum.
// Reuse the union so prop types and run.status are assignable to each other.
export type WorkflowRunStatus = WorkflowRun['status'];

export type ListRunsParams = {
  startingAfter?: string;
  endingBefore?: string;
  limit: number;
  statuses?: WorkflowRunStatus[];
  workflowId?: string;
};

export type ListRunsResult = {
  items: WorkflowRun[];
  nextCursor: string | null;
  prevCursor: string | null;
  hasMore: boolean;
  hasPrev: boolean;
};

export interface WorkflowRunsClient {
  listRuns(params: ListRunsParams): Promise<ListRunsResult>;
  getRun(id: string): Promise<WorkflowRun>;
}

export type CreateFetchClientOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
};

export function createFetchClient(opts: CreateFetchClientOptions): WorkflowRunsClient {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const trimmed = opts.baseUrl.replace(/\/$/, '');

  return {
    async listRuns(params) {
      const url = new URL(trimmed, 'http://internal');
      if (params.startingAfter) url.searchParams.set('starting_after', params.startingAfter);
      if (params.endingBefore) url.searchParams.set('ending_before', params.endingBefore);
      url.searchParams.set('limit', String(params.limit));
      if (params.workflowId) url.searchParams.set('workflow_id', params.workflowId);
      for (const s of params.statuses ?? []) url.searchParams.append('statuses', s);
      const target = trimmed + url.search;
      const res = await fetchImpl(target, { method: 'GET' });
      if (!res.ok) throw new Error(`listRuns failed: ${res.status}`);
      return (await res.json()) as ListRunsResult;
    },
    async getRun(id) {
      const target = `${trimmed}/${encodeURIComponent(id)}`;
      const res = await fetchImpl(target, { method: 'GET' });
      if (!res.ok) throw new Error(`getRun failed: ${res.status}`);
      return (await res.json()) as WorkflowRun;
    },
  };
}
