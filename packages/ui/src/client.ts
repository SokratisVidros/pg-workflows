import type { WorkflowRun } from 'pg-workflows/client';

export type { WorkflowRun };

// WorkflowRun.status is a string union, not the WorkflowStatus enum.
// Reuse the union so prop types and run.status are assignable to each other.
export type WorkflowRunStatus = WorkflowRun['status'];

export type FastForwardBody = { data?: Record<string, unknown> };
export type TriggerEventBody = { eventName: string; data?: Record<string, unknown> };

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
  cancelRun(id: string): Promise<WorkflowRun>;
  pauseRun(id: string): Promise<WorkflowRun>;
  resumeRun(id: string): Promise<WorkflowRun>;
  fastForwardRun(id: string, body?: FastForwardBody): Promise<WorkflowRun>;
  triggerEvent(id: string, body: TriggerEventBody): Promise<WorkflowRun>;
}

export type CreateFetchClientOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
};

export function createFetchClient(opts: CreateFetchClientOptions): WorkflowRunsClient {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const trimmed = opts.baseUrl.replace(/\/$/, '');

  async function postAction(target: string, body?: unknown): Promise<WorkflowRun> {
    const init: RequestInit = { method: 'POST' };
    if (body !== undefined) {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const res = await fetchImpl(target, init);
    if (!res.ok) throw new Error(`POST ${target} failed: ${res.status}`);
    return (await res.json()) as WorkflowRun;
  }

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
    async cancelRun(id) {
      return postAction(`${trimmed}/${encodeURIComponent(id)}/cancel`);
    },
    async pauseRun(id) {
      return postAction(`${trimmed}/${encodeURIComponent(id)}/pause`);
    },
    async resumeRun(id) {
      return postAction(`${trimmed}/${encodeURIComponent(id)}/resume`);
    },
    async fastForwardRun(id, body) {
      return postAction(`${trimmed}/${encodeURIComponent(id)}/fast-forward`, body);
    },
    async triggerEvent(id, body) {
      return postAction(`${trimmed}/${encodeURIComponent(id)}/trigger`, body);
    },
  };
}
