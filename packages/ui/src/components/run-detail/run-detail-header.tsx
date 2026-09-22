'use client';

import { Button } from '@base-ui/react/button';
import { clsx } from 'clsx';
import { ArrowLeft, Copy } from 'lucide-react';
import { forwardRef } from 'react';
import type { WorkflowRun } from '../../client';
import { PGW_BUTTON_ICON } from '../../lib/button-classes';
import { computeDurationMs, formatDuration } from '../../lib/duration';
import { type ElementStyleProps, StyledElement } from '../../lib/style-hooks';
import { useCopyText } from '../../lib/use-copy';
import { StatusBadge } from '../status-badge';
import { Timestamp } from '../timestamp';

export type RunDetailHeaderState = {
  status: WorkflowRun['status'];
};

export type RunDetailHeaderProps = {
  run: WorkflowRun;
  onBack?: () => void;
} & ElementStyleProps<RunDetailHeaderState>;

export const RunDetailHeader = forwardRef<HTMLElement, RunDetailHeaderProps>(
  function RunDetailHeader({ run, onBack, className, style, render }, ref) {
    const duration = computeDurationMs(run);
    const { copied, copy } = useCopyText();

    return (
      <StyledElement
        ref={ref}
        tag="header"
        state={{ status: run.status }}
        className={className}
        style={style}
        render={render}
        baseClassName="flex flex-col gap-5"
      >
        <div className="relative flex items-center justify-center @min-[40rem]:justify-start @min-[40rem]:gap-3">
          {onBack && (
            <Button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className={clsx(PGW_BUTTON_ICON, 'absolute left-0 @min-[40rem]:static')}
            >
              <ArrowLeft className="size-4" />
            </Button>
          )}
          <h1 className="text-base font-semibold">Details</h1>
        </div>
        <div className="flex flex-col gap-3 @min-[40rem]:flex-row @min-[40rem]:items-start @min-[40rem]:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium text-pgw-muted-fg">{run.workflowId}</p>
            <div className="mt-1 flex min-w-0 items-center gap-2">
              <h2 className="truncate font-mono text-xl font-bold tracking-tight">{run.id}</h2>
              <Button
                type="button"
                aria-label={copied ? 'Copied run id' : 'Copy run id'}
                className={PGW_BUTTON_ICON}
                onClick={() => copy(run.id)}
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
            {run.resourceId && (
              <p className="mt-1 text-xs text-pgw-muted-fg">resource: {run.resourceId}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={run.status} />
            <p className="text-xs text-pgw-muted-fg">
              {duration != null ? formatDuration(duration) : '-'} · started{' '}
              <Timestamp value={run.createdAt} />
            </p>
          </div>
        </div>
      </StyledElement>
    );
  },
);
