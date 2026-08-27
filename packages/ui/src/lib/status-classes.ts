import type { WorkflowRunStatus } from '../client';

// Full literal class names so Tailwind's content scanner can statically discover them.
// Do not build these via string interpolation (`bg-${token}`) — that hides the classes
// from the scanner and they never get emitted in real builds.
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
