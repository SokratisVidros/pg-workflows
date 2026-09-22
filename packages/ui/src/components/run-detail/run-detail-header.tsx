'use client';

import { clsx } from 'clsx';
import { ArrowLeft, Copy } from 'lucide-react';
import { forwardRef, useState } from 'react';
import type { WorkflowRun } from '../../client';
import { PGW_PILL_ICON } from '../../lib/button-classes';
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
    const [copied, setCopied] = useState(false);

    return (
      <header ref={ref} className={clsx('flex flex-col gap-5', className)}>
        <div className="relative flex items-center justify-center @min-[40rem]:justify-start @min-[40rem]:gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className={clsx(PGW_PILL_ICON, 'absolute left-0 @min-[40rem]:static')}
            >
              <ArrowLeft className="size-4" />
            </button>
          )}
          <h1 className="text-base font-semibold">Details</h1>
        </div>
        <div className="flex flex-col gap-3 @min-[40rem]:flex-row @min-[40rem]:items-start @min-[40rem]:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium text-pgw-muted-fg">{run.workflowId}</p>
            <div className="mt-1 flex min-w-0 items-center gap-2">
              <h2 className="truncate font-mono text-xl font-bold tracking-tight">{run.id}</h2>
              <button
                type="button"
                aria-label={copied ? 'Copied run id' : 'Copy run id'}
                className={PGW_PILL_ICON}
                onClick={() => {
                  void navigator.clipboard.writeText(run.id);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                <Copy className="size-3.5" />
              </button>
            </div>
            {resourceId && <p className="mt-1 text-xs text-pgw-muted-fg">resource: {resourceId}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={run.status} />
            <p className="text-xs text-pgw-muted-fg">
              {duration != null ? formatDuration(duration) : '-'} · started {timeAgo(run.createdAt)}
            </p>
          </div>
        </div>
      </header>
    );
  },
);
