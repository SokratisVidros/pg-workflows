'use client';

import { Button } from '@base-ui/react/button';
import { Tooltip } from '@base-ui/react/tooltip';
import { clsx } from 'clsx';
import { FastForward, Loader2, Pause, Play, Radio, X } from 'lucide-react';
import { forwardRef, type ReactNode, useState } from 'react';
import {
  useCancelRun,
  useFastForwardRun,
  usePauseRun,
  useResumeRun,
  useTriggerEvent,
} from '../../hooks/use-run-mutations';
import { useWorkflowRun } from '../../hooks/use-workflow-run';
import { PGW_BUTTON } from '../../lib/button-classes';
import { computeDurationMs, formatDuration, isTerminalStatus } from '../../lib/duration';
import { type ElementStyleProps, StyledElement } from '../../lib/style-hooks';
import { RunProgress } from '../run-progress';
import { Timestamp } from '../timestamp';
import { JsonViewer } from './json-viewer';
import { RunDetailHeader } from './run-detail-header';
import { StepTimeline } from './step-timeline';

export type RunDetailState = {
  phase: 'loading' | 'error' | 'ready';
  status?: string;
};

export type RunDetailProps = {
  runId: string;
  onBack?: () => void;
} & ElementStyleProps<RunDetailState>;

const RUN_TIMESTAMPS = [
  ['Started', 'createdAt'],
  ['Updated', 'updatedAt'],
  ['Completed', 'completedAt'],
  ['Paused', 'pausedAt'],
  ['Resumed', 'resumedAt'],
  ['Scheduled', 'scheduledAt'],
  ['Timeout', 'timeoutAt'],
] as const;

const primaryBtn = clsx(PGW_BUTTON, 'w-full @min-[40rem]:w-auto');
const ghostBtn = PGW_BUTTON;

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

function RunAction({
  label,
  pending,
  disabled,
  onClick,
  icon,
  prominent,
}: {
  label: string;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
  icon?: ReactNode;
  prominent?: boolean;
}) {
  return (
    <Button
      type="button"
      className={prominent ? primaryBtn : ghostBtn}
      disabled={disabled}
      onClick={onClick}
    >
      {pending && (
        <Loader2
          className={clsx(prominent ? 'h-4 w-4' : 'h-3 w-3', 'animate-spin')}
          aria-hidden="true"
          data-testid="spinner"
        />
      )}
      {icon && (!prominent || !pending) ? icon : null}
      {label}
    </Button>
  );
}

function DetailRow({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <>
      <dt className="text-pgw-muted-fg">{label}</dt>
      <dd className={clsx('text-right font-medium', className)}>{children}</dd>
    </>
  );
}

function JsonPanel({
  title,
  value,
  titleClassName,
}: {
  title: string;
  value: unknown;
  titleClassName?: string;
}) {
  return (
    <div className="pgw-panel">
      <h3 className={clsx('mb-3 text-sm font-bold', titleClassName)}>{title}</h3>
      <JsonViewer value={value} />
    </div>
  );
}

type ActionFeedback = { kind: 'success' | 'error'; message: string };

export const RunDetail = forwardRef<HTMLElement, RunDetailProps>(function RunDetail(
  { runId, onBack, className, style, render },
  ref,
) {
  const { data: run, isLoading, error } = useWorkflowRun(runId);
  const cancel = useCancelRun();
  const pause = usePauseRun();
  const resume = useResumeRun();
  const fastForward = useFastForwardRun();
  const trigger = useTriggerEvent();
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);

  function feedbackCallbacks(label: string) {
    return {
      onSuccess: () => setFeedback({ kind: 'success', message: `${label}.` }),
      onError: (err: Error) => setFeedback({ kind: 'error', message: err.message }),
    };
  }

  const styleProps = { className, style, render };

  if (isLoading) {
    return (
      <StyledElement
        ref={ref}
        {...styleProps}
        state={{ phase: 'loading' }}
        baseClassName="p-6 text-pgw-muted-fg"
      >
        Loading…
      </StyledElement>
    );
  }
  if (error || !run) {
    return (
      <StyledElement
        ref={ref}
        {...styleProps}
        state={{ phase: 'error' }}
        baseClassName="p-6 text-pgw-status-failed"
      >
        Failed to load run.{' '}
        {onBack && (
          <Button type="button" className={PGW_BUTTON} onClick={onBack}>
            Back
          </Button>
        )}
      </StyledElement>
    );
  }

  const terminal = isTerminalStatus(run.status);
  const duration = computeDurationMs(run);
  const paused = run.status === 'paused';
  const pauseDisabled = run.status !== 'running' || pause.isPending;
  const resumeDisabled = !paused || resume.isPending;

  function perform(action: () => void) {
    setFeedback(null);
    action();
  }

  return (
    <Tooltip.Provider delay={300}>
      <StyledElement
        ref={ref}
        {...styleProps}
        state={{ phase: 'ready', status: run.status }}
        baseClassName="flex flex-col gap-5"
      >
        <RunDetailHeader run={run} onBack={onBack} />
        <RunProgress run={run} />
        <RunAction
          prominent
          label={paused ? 'Resume' : 'Pause'}
          pending={paused ? resume.isPending : pause.isPending}
          disabled={paused ? resumeDisabled : pauseDisabled}
          icon={
            paused ? (
              <Play className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Pause className="h-4 w-4" aria-hidden="true" />
            )
          }
          onClick={() =>
            perform(() =>
              paused
                ? resume.mutate({ id: runId }, feedbackCallbacks('Resumed'))
                : pause.mutate({ id: runId }, feedbackCallbacks('Paused')),
            )
          }
        />
        <div className="flex flex-wrap items-center gap-2">
          <RunAction
            label="Cancel"
            pending={cancel.isPending}
            disabled={terminal || cancel.isPending}
            icon={<X className="h-3 w-3" aria-hidden="true" />}
            onClick={() =>
              perform(() => cancel.mutate({ id: runId }, feedbackCallbacks('Cancelled')))
            }
          />
          {paused ? (
            <RunAction
              label="Pause"
              pending={pause.isPending}
              disabled={pauseDisabled}
              onClick={() =>
                perform(() => pause.mutate({ id: runId }, feedbackCallbacks('Paused')))
              }
            />
          ) : (
            <RunAction
              label="Resume"
              pending={resume.isPending}
              disabled={resumeDisabled}
              onClick={() =>
                perform(() => resume.mutate({ id: runId }, feedbackCallbacks('Resumed')))
              }
            />
          )}
          <RunAction
            label="Fast-forward"
            pending={fastForward.isPending}
            disabled={terminal || fastForward.isPending}
            icon={<FastForward className="h-3 w-3" aria-hidden="true" />}
            onClick={() =>
              perform(() => fastForward.mutate({ id: runId }, feedbackCallbacks('Fast-forwarded')))
            }
          />
          <RunAction
            label="Trigger"
            pending={trigger.isPending}
            disabled={terminal || trigger.isPending}
            icon={<Radio className="h-3 w-3" aria-hidden="true" />}
            onClick={() =>
              perform(() =>
                trigger.mutate({ id: runId, eventName: 'resume' }, feedbackCallbacks('Triggered')),
              )
            }
          />
        </div>
        {feedback && (
          <div
            className={clsx(
              'border px-4 py-3 text-sm',
              feedback.kind === 'error'
                ? 'border-pgw-status-failed text-pgw-status-failed'
                : 'border-pgw-status-completed text-pgw-status-completed',
            )}
          >
            {feedback.message}
          </div>
        )}
        <section className="pgw-panel">
          <h3 className="mb-4 text-sm font-bold">Run details</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
            <DetailRow label="Workflow">{run.workflowId}</DetailRow>
            <DetailRow label="Resource ID">{run.resourceId ?? '—'}</DetailRow>
            <DetailRow label="Status" className="capitalize">
              {run.status}
            </DetailRow>
            {RUN_TIMESTAMPS.map(([label, key]) => {
              const value = run[key];
              if (value == null && key !== 'completedAt') return null;
              return (
                <DetailRow key={key} label={label}>
                  {value == null ? '—' : <Timestamp value={value} />}
                </DetailRow>
              );
            })}
            <DetailRow label="Duration" className="tabular-nums">
              {duration != null ? formatDuration(duration) : '—'}
            </DetailRow>
            <DetailRow label="Retries" className="tabular-nums">
              {formatRetries(run.retryCount, run.maxRetries)}
            </DetailRow>
            <DetailRow label="Priority">{formatPriority(run.priority)}</DetailRow>
            <DetailRow label="Job" className="font-mono">
              {run.jobId ?? '—'}
            </DetailRow>
            {run.error == null && <DetailRow label="Error">—</DetailRow>}
          </dl>
        </section>
        <section className="pgw-panel">
          <StepTimeline run={run} />
        </section>
        <section className="flex flex-col gap-3">
          <JsonPanel title="Input" value={run.input} />
          <JsonPanel title="Output" value={run.output} />
          {run.error != null && (
            <JsonPanel title="Error" value={run.error} titleClassName="text-pgw-status-failed" />
          )}
        </section>
      </StyledElement>
    </Tooltip.Provider>
  );
});
