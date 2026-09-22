'use client';

import { Button } from '@base-ui/react/button';
import { clsx } from 'clsx';
import { ArrowLeft, Copy } from 'lucide-react';
import { forwardRef, type ReactNode } from 'react';
import type { WorkflowRun } from '../../client';
import { PGW_BUTTON_ICON } from '../../lib/button-classes';
import { computeDurationMs, formatDuration } from '../../lib/duration';
import { extractSteps } from '../../lib/steps';
import { type ElementStyleProps, StyledElement } from '../../lib/style-hooks';
import { useCopyText } from '../../lib/use-copy';
import { RunProgress } from '../run-progress';
import { StatusIcon } from '../status-icon';
import { Timestamp } from '../timestamp';

export type RunDetailHeaderState = {
  status: WorkflowRun['status'];
};

export type RunDetailHeaderProps = {
  run: WorkflowRun;
  onBack?: () => void;
} & ElementStyleProps<RunDetailHeaderState>;

const RUN_TIMESTAMPS = [
  ['Started', 'createdAt'],
  ['Updated', 'updatedAt'],
  ['Completed', 'completedAt'],
  ['Paused', 'pausedAt'],
  ['Resumed', 'resumedAt'],
  ['Scheduled', 'scheduledAt'],
  ['Timeout', 'timeoutAt'],
] as const;

type DetailField = {
  key: string;
  label: string;
  value: ReactNode;
  className?: string;
};

function formatPriority(priority: number | null | undefined): string {
  if (priority == null || Number.isNaN(priority)) return '—';
  if (priority === 100) return 'high';
  if (priority === 0) return 'normal';
  if (priority === -100) return 'low';
  return String(priority);
}

function formatRetries(
  retryCount: number | null | undefined,
  maxRetries: number | null | undefined,
) {
  if (retryCount == null && maxRetries == null) return '—';
  if (maxRetries == null) return String(retryCount ?? 0);
  return `${retryCount ?? 0} / ${maxRetries}`;
}

function detailFields(run: WorkflowRun, duration: number | null): DetailField[] {
  const fields: DetailField[] = [
    { key: 'workflow', label: 'Workflow', value: run.workflowId },
    { key: 'resource', label: 'Resource ID', value: run.resourceId ?? '—' },
    { key: 'status', label: 'Status', value: run.status, className: 'capitalize' },
  ];

  for (const [label, key] of RUN_TIMESTAMPS) {
    const value = run[key];
    if (value == null && key !== 'completedAt') continue;
    fields.push({
      key,
      label,
      value: value == null ? '—' : <Timestamp value={value} />,
    });
  }

  fields.push(
    {
      key: 'duration',
      label: 'Duration',
      className: 'tabular-nums',
      value: duration != null ? formatDuration(duration) : '—',
    },
    {
      key: 'retries',
      label: 'Retries',
      className: 'tabular-nums',
      value: formatRetries(run.retryCount, run.maxRetries),
    },
    { key: 'priority', label: 'Priority', value: formatPriority(run.priority) },
    { key: 'job', label: 'Job', className: 'break-all font-mono', value: run.jobId ?? '—' },
  );

  if (run.error == null) {
    fields.push({ key: 'error', label: 'Error', value: '—' });
  }

  return fields;
}

export const RunDetailHeader = forwardRef<HTMLElement, RunDetailHeaderProps>(
  function RunDetailHeader({ run, onBack, className, style, render }, ref) {
    const duration = computeDurationMs(run);
    const { copied, copy } = useCopyText();
    const showProgress = run.status !== 'completed' && extractSteps(run).length > 0;

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
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p
              title={run.workflowId}
              className="min-w-0 flex-1 truncate text-xs font-medium text-pgw-muted-fg"
            >
              {run.workflowId}
            </p>
            {showProgress && (
              <div className="order-last w-full min-w-0 @min-[40rem]:order-0 @min-[40rem]:w-56 @min-[40rem]:flex-none">
                <RunProgress run={run} className="w-full" />
              </div>
            )}
            <StatusIcon status={run.status} />
          </div>
          <div className="flex flex-col gap-1 @min-[40rem]:flex-row @min-[40rem]:items-start @min-[40rem]:justify-between">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
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
            <p className="text-xs text-pgw-muted-fg">
              {duration != null ? formatDuration(duration) : '-'} · started{' '}
              <Timestamp value={run.createdAt} />
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-x-8 gap-y-3 @min-[40rem]:grid-cols-3">
          {detailFields(run, duration).map((field) => (
            <dl
              key={field.key}
              className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-6 text-sm"
            >
              <dt className="text-pgw-muted-fg">{field.label}</dt>
              <dd className={clsx('text-right font-medium', field.className)}>{field.value}</dd>
            </dl>
          ))}
        </div>
      </StyledElement>
    );
  },
);
