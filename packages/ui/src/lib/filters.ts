import type { WorkflowRun } from '../client';
import { computeDurationMs } from './duration';

export type ClientFilters = {
  from?: string;
  to?: string;
  minDuration?: number;
  maxDuration?: number;
  search?: string;
};

export function applyClientFilters(runs: WorkflowRun[], filters: ClientFilters): WorkflowRun[] {
  return runs.filter((run) => {
    if (filters.from) {
      const fromDate = new Date(filters.from).getTime();
      if (new Date(run.createdAt).getTime() < fromDate) return false;
    }
    if (filters.to) {
      const toDate = new Date(filters.to).getTime();
      if (new Date(run.createdAt).getTime() > toDate) return false;
    }
    const durationMs = computeDurationMs(run);
    if (
      filters.minDuration != null &&
      (durationMs == null || durationMs < filters.minDuration * 1000)
    ) {
      return false;
    }
    if (
      filters.maxDuration != null &&
      (durationMs == null || durationMs > filters.maxDuration * 1000)
    ) {
      return false;
    }
    if (filters.search) {
      const query = filters.search.toLowerCase();
      const matchesRunId = run.id.toLowerCase().includes(query);
      const matchesWorkflowId = run.workflowId.toLowerCase().includes(query);
      const resourceId = (run as unknown as { resourceId?: string }).resourceId;
      const matchesResourceId =
        typeof resourceId === 'string' && resourceId.toLowerCase().includes(query);
      if (!matchesRunId && !matchesWorkflowId && !matchesResourceId) return false;
    }
    return true;
  });
}

export type SortKey = 'id' | 'workflowId' | 'createdAt' | 'status' | 'duration';
export type SortDir = 'asc' | 'desc';

export function sortRuns(runs: WorkflowRun[], key: SortKey, dir: SortDir): WorkflowRun[] {
  const sorted = [...runs].sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case 'id':
        cmp = a.id.localeCompare(b.id);
        break;
      case 'workflowId':
        cmp = a.workflowId.localeCompare(b.workflowId);
        break;
      case 'createdAt':
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
      case 'status':
        cmp = a.status.localeCompare(b.status);
        break;
      case 'duration': {
        const da = computeDurationMs(a) ?? -1;
        const db = computeDurationMs(b) ?? -1;
        cmp = da - db;
        break;
      }
    }
    return cmp;
  });
  return dir === 'desc' ? sorted.reverse() : sorted;
}
