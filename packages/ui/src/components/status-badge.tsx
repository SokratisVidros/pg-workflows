import type { WorkflowRunStatus } from '../client';
import { cn } from '../lib/cn';

const TOKEN_BY_STATUS: Record<WorkflowRunStatus, string> = {
  completed: 'pgw-status-completed',
  failed: 'pgw-status-failed',
  running: 'pgw-status-running',
  paused: 'pgw-status-paused',
  cancelled: 'pgw-status-cancelled',
  pending: 'pgw-status-pending',
};

export type StatusBadgeProps = {
  status: WorkflowRunStatus;
  className?: string;
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const token = TOKEN_BY_STATUS[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-pgw-border px-2 py-0.5 text-xs',
        `text-${token}`,
        className,
      )}
    >
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', `bg-${token}`)} />
      {status}
    </span>
  );
}
