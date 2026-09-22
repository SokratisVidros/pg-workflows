'use client';

import { Button } from '@base-ui/react/button';
import { Tooltip } from '@base-ui/react/tooltip';
import { clsx } from 'clsx';
import { FastForward, Loader2, Pause, Play, Radio, X } from 'lucide-react';
import { forwardRef, type ReactNode, useState } from 'react';
import { useRunActions } from '../../hooks/use-run-mutations';
import { useWorkflowRun } from '../../hooks/use-workflow-run';
import { PGW_BUTTON } from '../../lib/button-classes';
import { isTerminalStatus } from '../../lib/duration';
import { type ElementStyleProps, StyledElement } from '../../lib/style-hooks';
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

function RunAction({
  label,
  pending,
  disabled,
  onClick,
  icon,
}: {
  label: string;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
  icon?: ReactNode;
}) {
  return (
    <Button type="button" className={PGW_BUTTON} disabled={disabled} onClick={onClick}>
      {pending && (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" data-testid="spinner" />
      )}
      {icon}
      {label}
    </Button>
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
  const { cancel, pause, resume, fastForward, trigger } = useRunActions();
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
          <RunAction
            label="Pause"
            pending={pause.isPending}
            disabled={pauseDisabled}
            icon={<Pause className="h-3 w-3" aria-hidden="true" />}
            onClick={() => perform(() => pause.mutate({ id: runId }, feedbackCallbacks('Paused')))}
          />
          <RunAction
            label="Resume"
            pending={resume.isPending}
            disabled={resumeDisabled}
            icon={<Play className="h-3 w-3" aria-hidden="true" />}
            onClick={() =>
              perform(() => resume.mutate({ id: runId }, feedbackCallbacks('Resumed')))
            }
          />
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
        {run.status === 'failed' && run.error != null && (
          <JsonPanel title="Error" value={run.error} titleClassName="text-pgw-status-failed" />
        )}
        <section className="pgw-panel">
          <StepTimeline run={run} />
        </section>
        <section className="flex flex-col gap-3">
          <JsonPanel title="Input" value={run.input} />
          <JsonPanel title="Output" value={run.output} />
          {run.error != null && run.status !== 'failed' && (
            <JsonPanel title="Error" value={run.error} titleClassName="text-pgw-status-failed" />
          )}
        </section>
      </StyledElement>
    </Tooltip.Provider>
  );
});
