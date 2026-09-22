'use client';

import { Button } from '@base-ui/react/button';
import { AlertCircle, Ban, CheckCircle, Clock, Loader2, Pause } from 'lucide-react';
import { forwardRef, type ReactNode } from 'react';
import type { WorkflowRunStatus } from '../client';
import { WORKFLOW_RUN_STATUSES } from '../lib/statuses';
import {
  chainClassName,
  type ElementStyleProps,
  type PartProps,
  StyledElement,
} from '../lib/style-hooks';

const STATUS_ICON: Record<WorkflowRunStatus, typeof Clock> = {
  pending: Clock,
  running: Loader2,
  paused: Pause,
  completed: CheckCircle,
  failed: AlertCircle,
  cancelled: Ban,
};

export type StatusSummaryState = {
  empty: boolean;
};

export type StatusSummaryProps = {
  counts: Partial<Record<WorkflowRunStatus, number>>;
  onSelectStatus?: (status: WorkflowRunStatus) => void;
  trailing?: ReactNode;
  stat?: PartProps<Button.Props>;
} & ElementStyleProps<StatusSummaryState>;

export const StatusSummary = forwardRef<HTMLElement, StatusSummaryProps>(function StatusSummary(
  { counts = {}, onSelectStatus, trailing, className, style, render, stat },
  ref,
) {
  const present = WORKFLOW_RUN_STATUSES.filter((status) => (counts[status] ?? 0) > 0);

  if (present.length === 0) return null;

  return (
    <StyledElement
      ref={ref}
      state={{ empty: false }}
      className={className}
      style={style}
      render={render}
      baseClassName="flex w-full flex-row items-stretch justify-between gap-2 overflow-x-auto"
    >
      {present.map((status) => {
        const Icon = STATUS_ICON[status];
        const count = counts[status] ?? 0;
        return (
          <Button
            key={status}
            type="button"
            aria-label={`${count} ${status}`}
            onClick={() => onSelectStatus?.(status)}
            className={chainClassName('pgw-stat text-left', stat?.className)}
            style={stat?.style}
            render={stat?.render}
          >
            <span className="flex items-center gap-2 text-sm">
              <Icon aria-hidden className="size-4 shrink-0" />
              <span className="capitalize">{status}</span>
            </span>
            <span className="text-2xl font-bold tabular-nums">{count}</span>
          </Button>
        );
      })}
      {trailing}
    </StyledElement>
  );
});
