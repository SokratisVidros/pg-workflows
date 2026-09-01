'use client';

import { clsx } from 'clsx';
import { forwardRef } from 'react';
import type { WorkflowRun, WorkflowRunStatus } from '../client';
import { STATUS_TEXT_CLASS } from '../lib/status-classes';

const STATUS_ORDER: WorkflowRunStatus[] = [
  'pending',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
];

export type StatusSummaryProps = {
  runs: WorkflowRun[];
  onSelectStatus?: (status: WorkflowRunStatus) => void;
  className?: string;
};

export const StatusSummary = forwardRef<HTMLDivElement, StatusSummaryProps>(function StatusSummary(
  { runs, onSelectStatus, className },
  ref,
) {
  const counts = runs.reduce(
    (acc, run) => {
      acc[run.status] = (acc[run.status] ?? 0) + 1;
      return acc;
    },
    {} as Partial<Record<WorkflowRunStatus, number>>,
  );

  const present = STATUS_ORDER.filter((status) => (counts[status] ?? 0) > 0);

  if (present.length === 0) return null;

  return (
    <div
      ref={ref}
      className={clsx(
        'inline-flex items-stretch overflow-hidden rounded-md border border-pgw-border',
        className,
      )}
    >
      {present.map((status, index) => {
        return (
          <button
            key={status}
            type="button"
            onClick={() => onSelectStatus?.(status)}
            className={clsx(
              'flex w-24 flex-col items-center gap-0.5 px-3 py-2 text-center hover:bg-pgw-muted',
              index > 0 && 'border-l border-pgw-border',
            )}
          >
            <span className={clsx('text-lg font-semibold', STATUS_TEXT_CLASS[status])}>
              {counts[status]}
            </span>
            <span className="text-xs text-pgw-muted-fg">{status}</span>
          </button>
        );
      })}
    </div>
  );
});
