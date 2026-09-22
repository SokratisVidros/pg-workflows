'use client';

import { clsx } from 'clsx';
import { FastForward, Loader2, Pause, Play, Radio, X } from 'lucide-react';
import { forwardRef, useState } from 'react';
import {
  useCancelRun,
  useFastForwardRun,
  usePauseRun,
  useResumeRun,
  useTriggerEvent,
} from '../../hooks/use-run-mutations';
import { useWorkflowRun } from '../../hooks/use-workflow-run';
import { PGW_PILL, PGW_PILL_OUTLINE } from '../../lib/button-classes';
import { isTerminalStatus } from '../../lib/duration';
import { RunProgress } from '../run-progress';
import { JsonViewer } from './json-viewer';
import { RunDetailHeader } from './run-detail-header';
import { StepTimeline } from './step-timeline';

export type RunDetailProps = {
  runId: string;
  onBack?: () => void;
  className?: string;
};

const primaryBtn = clsx(PGW_PILL, 'min-h-12 w-full px-6 text-sm @min-[40rem]:w-auto');
const ghostBtn = PGW_PILL_OUTLINE;

type ActionFeedback = { kind: 'success' | 'error'; message: string };

export const RunDetail = forwardRef<HTMLDivElement, RunDetailProps>(function RunDetail(
  { runId, onBack, className },
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

  if (isLoading) {
    return (
      <div ref={ref} className={clsx('p-6 text-pgw-muted-fg', className)}>
        Loading…
      </div>
    );
  }
  if (error || !run) {
    return (
      <div ref={ref} className={clsx('p-6 text-pgw-status-failed', className)}>
        Failed to load run.{' '}
        {onBack && (
          <button type="button" className="underline" onClick={onBack}>
            Back
          </button>
        )}
      </div>
    );
  }

  const terminal = isTerminalStatus(run.status);
  const pauseDisabled = run.status !== 'running' || pause.isPending;
  const resumeDisabled = run.status !== 'paused' || resume.isPending;

  return (
    <div ref={ref} className={clsx('flex flex-col gap-5', className)}>
      <RunDetailHeader run={run} onBack={onBack} />
      <RunProgress run={run} />
      {run.status === 'paused' ? (
        <button
          type="button"
          className={primaryBtn}
          disabled={resumeDisabled}
          onClick={() => {
            setFeedback(null);
            resume.mutate({ id: runId }, feedbackCallbacks('Resumed'));
          }}
        >
          {resume.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" data-testid="spinner" />
          ) : (
            <Play className="h-4 w-4" aria-hidden="true" />
          )}
          Resume
        </button>
      ) : (
        <button
          type="button"
          className={primaryBtn}
          disabled={pauseDisabled}
          onClick={() => {
            setFeedback(null);
            pause.mutate({ id: runId }, feedbackCallbacks('Paused'));
          }}
        >
          {pause.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" data-testid="spinner" />
          ) : (
            <Pause className="h-4 w-4" aria-hidden="true" />
          )}
          Pause
        </button>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={ghostBtn}
          disabled={terminal || cancel.isPending}
          onClick={() => {
            setFeedback(null);
            cancel.mutate({ id: runId }, feedbackCallbacks('Cancelled'));
          }}
        >
          {cancel.isPending && (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" data-testid="spinner" />
          )}
          <X className="h-3 w-3" aria-hidden="true" />
          Cancel
        </button>
        {run.status === 'paused' ? (
          <button
            type="button"
            className={ghostBtn}
            disabled={pauseDisabled}
            onClick={() => {
              setFeedback(null);
              pause.mutate({ id: runId }, feedbackCallbacks('Paused'));
            }}
          >
            {pause.isPending && (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" data-testid="spinner" />
            )}
            Pause
          </button>
        ) : (
          <button
            type="button"
            className={ghostBtn}
            disabled={resumeDisabled}
            onClick={() => {
              setFeedback(null);
              resume.mutate({ id: runId }, feedbackCallbacks('Resumed'));
            }}
          >
            {resume.isPending && (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" data-testid="spinner" />
            )}
            Resume
          </button>
        )}
        <button
          type="button"
          className={ghostBtn}
          disabled={terminal || fastForward.isPending}
          onClick={() => {
            setFeedback(null);
            fastForward.mutate({ id: runId }, feedbackCallbacks('Fast-forwarded'));
          }}
        >
          {fastForward.isPending && (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" data-testid="spinner" />
          )}
          <FastForward className="h-3 w-3" aria-hidden="true" />
          Fast-forward
        </button>
        <button
          type="button"
          className={ghostBtn}
          disabled={terminal || trigger.isPending}
          onClick={() => {
            setFeedback(null);
            trigger.mutate({ id: runId, eventName: 'resume' }, feedbackCallbacks('Triggered'));
          }}
        >
          {trigger.isPending && (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" data-testid="spinner" />
          )}
          <Radio className="h-3 w-3" aria-hidden="true" />
          Trigger
        </button>
      </div>
      {feedback && (
        <div
          className={clsx(
            'rounded-pgw-sm px-4 py-3 text-sm font-medium',
            feedback.kind === 'error'
              ? 'bg-pgw-status-failed/10 text-pgw-status-failed'
              : 'bg-pgw-status-completed/10 text-pgw-status-completed',
          )}
        >
          {feedback.message}
        </div>
      )}
      <section className="rounded-pgw bg-pgw-card p-5 shadow-pgw">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">Run details</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
          <dt className="text-pgw-muted-fg">Workflow</dt>
          <dd className="text-right font-medium">{run.workflowId}</dd>
          <dt className="text-pgw-muted-fg">Resource</dt>
          <dd className="text-right font-medium">{run.resourceId ?? '—'}</dd>
          <dt className="text-pgw-muted-fg">Started</dt>
          <dd className="text-right font-medium">{new Date(run.createdAt).toLocaleString()}</dd>
        </dl>
      </section>
      <section className="rounded-pgw bg-pgw-card p-5 shadow-pgw">
        <StepTimeline run={run} />
      </section>
      <section className="flex flex-col gap-3">
        <div className="rounded-pgw bg-pgw-card p-5 shadow-pgw">
          <h3 className="mb-3 text-sm font-semibold">Input</h3>
          <JsonViewer value={run.input} />
        </div>
        <div className="rounded-pgw bg-pgw-card p-5 shadow-pgw">
          <h3 className="mb-3 text-sm font-semibold">Output</h3>
          <JsonViewer value={run.output} />
        </div>
        {run.error != null && (
          <div className="rounded-pgw bg-pgw-card p-5 shadow-pgw">
            <h3 className="mb-3 text-sm font-semibold text-pgw-status-failed">Error</h3>
            <JsonViewer value={run.error} />
          </div>
        )}
      </section>
    </div>
  );
});
