'use client';

import { clsx } from 'clsx';
import { forwardRef } from 'react';
import type { WorkflowRun } from '../../client';
import { computeDurationMs, formatDuration, timeAgo } from '../../lib/duration';
import { StatusBadge } from '../status-badge';

export type RunDetailHeaderProps = {
  run: WorkflowRun;
  onBack?: () => void;
  className?: string;
};

export const RunDetailHeader = forwardRef<HTMLElement, RunDetailHeaderProps>(
  function RunDetailHeader({ run, onBack, className }, ref) {
    const duration = computeDurationMs(run);
    const resourceId = (run as unknown as { resourceId?: string }).resourceId;
    return (
      <header
        ref={ref}
        className={clsx('flex flex-col gap-2 border-b border-pgw-border pb-4', className)}
      >
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="self-start text-xs text-pgw-muted-fg hover:text-pgw-fg"
          >
            Back
          </button>
        )}
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-xs text-pgw-muted-fg">{run.workflowId}</span>
            <h1 className="font-mono text-lg">{run.id}</h1>
            {resourceId && (
              <span className="text-xs text-pgw-muted-fg">resource: {resourceId}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={run.status} />
            <span className="text-xs text-pgw-muted-fg">
              {duration != null ? formatDuration(duration) : '-'} - started {timeAgo(run.createdAt)}
            </span>
          </div>
        </div>
      </header>
    );
  },
);
