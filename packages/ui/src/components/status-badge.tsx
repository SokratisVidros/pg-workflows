import { clsx } from 'clsx';
import { forwardRef } from 'react';
import type { WorkflowRunStatus } from '../client';

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
        'inline-flex items-center gap-1.5 rounded-pgw-pill border border-pgw-fg bg-pgw-card px-3 py-1 text-xs font-semibold capitalize text-pgw-fg',
        className,
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-pgw-fg" />
      {status}
    </span>
  );
});
