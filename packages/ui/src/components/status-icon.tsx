import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import type { WorkflowRunStatus } from '../client';

const STATUS_COLOR: Record<WorkflowRunStatus, string> = {
  pending: 'text-pgw-status-pending',
  running: 'text-pgw-status-running',
  paused: 'text-pgw-status-paused',
  completed: 'text-pgw-status-completed',
  failed: 'text-pgw-status-failed',
  cancelled: 'text-pgw-status-cancelled',
};

function Mark({ status }: { status: WorkflowRunStatus }): ReactNode {
  switch (status) {
    case 'completed':
      return <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />;
    case 'failed':
      return (
        <>
          <path d="M4 4 12 12" />
          <path d="M12 4 4 12" />
        </>
      );
    case 'paused':
      return <path fill="currentColor" stroke="none" d="M4 3h2.25v10H4zm5.75 0H12v10H9.75z" />;
    case 'running':
      return <path d="M8 2.75a5.25 5.25 0 1 1-4.2 2.1" />;
    case 'pending':
      return (
        <>
          <circle cx="8" cy="8" r="5.25" />
          <path d="M8 4.75V8l2.25 1.5" />
        </>
      );
    case 'cancelled':
      return (
        <>
          <circle cx="8" cy="8" r="5.25" />
          <path d="m4.1 11.9 7.8-7.8" />
        </>
      );
  }
}

/** Geometric status mark. Color comes from the status token; the glyph tells the state apart. */
export function StatusIcon({ status }: { status: WorkflowRunStatus }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      data-status-mark={status}
      className={clsx(
        'size-3.5 shrink-0',
        STATUS_COLOR[status],
        status === 'running' && 'origin-center animate-spin motion-reduce:animate-none',
      )}
    >
      <Mark status={status} />
    </svg>
  );
}
