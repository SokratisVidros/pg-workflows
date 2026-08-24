'use client';

import type { WorkflowRun, WorkflowRunStatus } from '../client';
import { cn } from '../lib/cn';
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

export function StatusSummary({ runs, onSelectStatus, className }: StatusSummaryProps) {
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
    <div className={cn('flex flex-wrap gap-2', className)}>
      {present.map((status) => {
        return (
          <button
            key={status}
            type="button"
            onClick={() => onSelectStatus?.(status)}
            className="flex min-w-16 flex-col items-center gap-0.5 rounded-md border border-pgw-border px-3 py-2 text-center hover:bg-pgw-muted"
          >
            <span className={cn('text-lg font-semibold', STATUS_TEXT_CLASS[status])}>
              {counts[status]}
            </span>
            <span className="text-xs text-pgw-muted-fg">{status}</span>
          </button>
        );
      })}
    </div>
  );
}
