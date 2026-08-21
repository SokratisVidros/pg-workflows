'use client';

import type { WorkflowRun, WorkflowRunStatus } from '../client';
import { cn } from '../lib/cn';

const TOKEN_BY_STATUS: Record<WorkflowRunStatus, string> = {
  completed: 'pgw-status-completed',
  failed: 'pgw-status-failed',
  running: 'pgw-status-running',
  paused: 'pgw-status-paused',
  cancelled: 'pgw-status-cancelled',
  pending: 'pgw-status-pending',
};

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
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {present.map((status) => {
        const token = TOKEN_BY_STATUS[status];
        return (
          <button
            key={status}
            type="button"
            onClick={() => onSelectStatus?.(status)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border border-pgw-border px-2 py-1 text-xs hover:bg-pgw-muted',
            )}
          >
            <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', `bg-${token}`)} />
            <span className="font-medium">{counts[status]}</span>
            <span className={`text-${token}`}>{status}</span>
          </button>
        );
      })}
    </div>
  );
}
