import type { WorkflowRun } from '../client';
import { computeDurationMs } from './duration';
import {
  type DatePreset,
  type DurationPreset,
  datePresetToFrom,
  durationPresetToBounds,
} from './filter-presets';

export type ClientFilters = {
  from?: string;
  to?: string;
  datePreset?: DatePreset;
  durationPreset?: DurationPreset;
  minDurationMs?: number;
  maxDurationMs?: number;
  search?: string;
};

export function applyClientFilters(runs: WorkflowRun[], filters: ClientFilters): WorkflowRun[] {
  const from = filters.from ?? datePresetToFrom(filters.datePreset);
  const durationBounds = durationPresetToBounds(filters.durationPreset);
  const minDurationMs = filters.minDurationMs ?? durationBounds.minDurationMs;
  const maxDurationMs = filters.maxDurationMs ?? durationBounds.maxDurationMs;

  return runs.filter((run) => {
    if (from) {
      const fromDate = new Date(from).getTime();
      if (new Date(run.createdAt).getTime() < fromDate) return false;
    }
    if (filters.to) {
      const toDate = new Date(filters.to).getTime();
      if (new Date(run.createdAt).getTime() > toDate) return false;
    }
    const durationMs = computeDurationMs(run);
    if (minDurationMs != null && (durationMs == null || durationMs < minDurationMs)) {
      return false;
    }
    if (maxDurationMs != null && (durationMs == null || durationMs > maxDurationMs)) {
      return false;
    }
    if (filters.search) {
      const query = filters.search.toLowerCase();
      const matchesRunId = run.id.toLowerCase().includes(query);
      const matchesWorkflowId = run.workflowId.toLowerCase().includes(query);
      const matchesResourceId =
        typeof run.resourceId === 'string' && run.resourceId.toLowerCase().includes(query);
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
