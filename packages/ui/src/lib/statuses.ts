import type { WorkflowRunStatus } from '../client';

/** Display order for status filters and summary counts. */
export const WORKFLOW_RUN_STATUSES = [
  'pending',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
] as const satisfies readonly WorkflowRunStatus[];
