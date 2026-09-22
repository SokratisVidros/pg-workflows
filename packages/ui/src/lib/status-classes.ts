import type { WorkflowRunStatus } from '../client';

/**
 * Status colour tokens kept for timeline bars and other non-badge chrome.
 * Class names are full literals so Tailwind's scanner can discover them.
 */
export const STATUS_TEXT_CLASS: Record<WorkflowRunStatus, string> = {
  completed: 'text-pgw-status-completed',
  failed: 'text-pgw-status-failed',
  running: 'text-pgw-status-running',
  paused: 'text-pgw-status-paused',
  cancelled: 'text-pgw-status-cancelled',
  pending: 'text-pgw-status-pending',
};

export const STATUS_DOT_CLASS: Record<WorkflowRunStatus, string> = {
  completed: 'bg-pgw-status-completed',
  failed: 'bg-pgw-status-failed',
  running: 'bg-pgw-status-running',
  paused: 'bg-pgw-status-paused',
  cancelled: 'bg-pgw-status-cancelled',
  pending: 'bg-pgw-status-pending',
};
