import { clsx } from 'clsx';
import { forwardRef } from 'react';
import type { WorkflowRunStatus } from '../client';
import { STATUS_DOT_CLASS, STATUS_TEXT_CLASS } from '../lib/status-classes';

export type StatusBadgeProps = {
  status: WorkflowRunStatus;
  className?: string;
};

export const StatusBadge = forwardRef<HTMLSpanElement, StatusBadgeProps>(function StatusBadge(
  { status, className },
  ref,
) {
  return (
    <span
      ref={ref}
      className={clsx(
        'inline-flex items-center gap-1 rounded-md border border-pgw-border px-2 py-0.5 text-xs',
        STATUS_TEXT_CLASS[status],
        className,
      )}
    >
      <span aria-hidden className={clsx('h-1.5 w-1.5 rounded-full', STATUS_DOT_CLASS[status])} />
      {status}
    </span>
  );
});
