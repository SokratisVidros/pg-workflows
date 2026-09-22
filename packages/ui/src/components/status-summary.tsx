'use client';

import { clsx } from 'clsx';
import { AlertCircle, Ban, CheckCircle, Clock, Loader2, Pause } from 'lucide-react';
import { forwardRef, type ReactNode } from 'react';
import type { WorkflowRunStatus } from '../client';

const STATUS_ORDER: WorkflowRunStatus[] = [
  'pending',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
];

const STATUS_ICON: Record<WorkflowRunStatus, typeof Clock> = {
  pending: Clock,
  running: Loader2,
  paused: Pause,
  completed: CheckCircle,
  failed: AlertCircle,
  cancelled: Ban,
};

export type StatusSummaryProps = {
  counts: Partial<Record<WorkflowRunStatus, number>>;
  onSelectStatus?: (status: WorkflowRunStatus) => void;
  trailing?: ReactNode;
  className?: string;
};

export const StatusSummary = forwardRef<HTMLDivElement, StatusSummaryProps>(function StatusSummary(
  { counts = {}, onSelectStatus, trailing, className },
  ref,
) {
  const present = STATUS_ORDER.filter((status) => (counts[status] ?? 0) > 0);

  if (present.length === 0) return null;

  return (
    <div
      ref={ref}
      className={clsx(
        'flex w-full flex-row items-start justify-between gap-6 overflow-x-auto',
        className,
      )}
    >
      {present.map((status) => {
        const Icon = STATUS_ICON[status];
        const count = counts[status] ?? 0;
        return (
          <button
            key={status}
            type="button"
            aria-label={`${count} ${status}`}
            onClick={() => onSelectStatus?.(status)}
            className="flex min-w-[8rem] flex-1 flex-col items-start gap-2 text-left"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-pgw-fg">
              <Icon aria-hidden className="size-4 shrink-0" />
              <span className="capitalize">{status}</span>
            </span>
            <span className="text-3xl font-extrabold tracking-tight tabular-nums text-pgw-fg @min-[48rem]:text-4xl">
              {count}
            </span>
          </button>
        );
      })}
      {trailing}
    </div>
  );
});
