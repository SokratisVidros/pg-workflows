import type { WorkflowRunStatus } from '../client';

/**
 * Single source of truth for status colouring, shared by `StatusBadge`
 * and `StepTimeline`.
 *
 * Class names are written out in full rather than interpolated from a design
 * token, because Tailwind's scanner only sees literal class strings — a
 * `text-${token}` template never gets generated into the stylesheet.
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
