'use client';

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import {
  useCancelRun,
  useFastForwardRun,
  usePauseRun,
  useResumeRun,
  useTriggerEvent,
} from '../../hooks/use-run-mutations';
import { useWorkflowRun } from '../../hooks/use-workflow-run';
import { cn } from '../../lib/cn';
import { isTerminalStatus } from '../../lib/duration';
import { extractSteps } from '../../lib/steps';
import { RunProgress } from '../run-progress';
import { JsonViewer } from './json-viewer';
import { RunDetailHeader } from './run-detail-header';
import { StepTimeline } from './step-timeline';
import { StepWaterfall } from './step-waterfall';

export type RunDetailProps = {
  runId: string;
  onBack?: () => void;
  className?: string;
};

const actionBtn =
  'inline-flex items-center gap-1.5 rounded border border-pgw-border px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 hover:bg-pgw-muted';

type ActionFeedback = { kind: 'success' | 'error'; message: string };

export function RunDetail({ runId, onBack, className }: RunDetailProps) {
  const { data: run, isLoading, error } = useWorkflowRun(runId);
  const cancel = useCancelRun();
  const pause = usePauseRun();
  const resume = useResumeRun();
  const fastForward = useFastForwardRun();
  const trigger = useTriggerEvent();
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);

  function feedbackCallbacks(label: string) {
    return {
      onSuccess: () => setFeedback({ kind: 'success', message: `${label}.` }),
      onError: (err: Error) => setFeedback({ kind: 'error', message: err.message }),
    };
  }

  if (isLoading) return <div className={cn('p-6 text-pgw-muted-fg', className)}>Loading…</div>;
  if (error || !run) {
    return (
      <div className={cn('p-6 text-pgw-status-failed', className)}>
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
  const selectedStepInfo = selectedStep
    ? extractSteps(run).find((s) => s.id === selectedStep)
    : undefined;

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <RunDetailHeader run={run} onBack={onBack} />
      <RunProgress run={run} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={actionBtn}
          disabled={terminal || cancel.isPending}
          onClick={() => {
            setFeedback(null);
            cancel.mutate({ id: runId }, feedbackCallbacks('Cancelled'));
          }}
        >
          {cancel.isPending && (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" data-testid="spinner" />
          )}
          Cancel
        </button>
        <button
          type="button"
          className={actionBtn}
          disabled={run.status !== 'running' || pause.isPending}
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
        <button
          type="button"
          className={actionBtn}
          disabled={run.status !== 'paused' || resume.isPending}
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
        <button
          type="button"
          className={actionBtn}
          disabled={terminal || fastForward.isPending}
          onClick={() => {
            setFeedback(null);
            fastForward.mutate({ id: runId }, feedbackCallbacks('Fast-forwarded'));
          }}
        >
          {fastForward.isPending && (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" data-testid="spinner" />
          )}
          Fast-forward
        </button>
        <button
          type="button"
          className={actionBtn}
          disabled={terminal || trigger.isPending}
          onClick={() => {
            setFeedback(null);
            trigger.mutate({ id: runId, eventName: 'resume' }, feedbackCallbacks('Triggered'));
          }}
        >
          {trigger.isPending && (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" data-testid="spinner" />
          )}
          Trigger
        </button>
      </div>
      {feedback && (
        <div
          className={cn(
            'rounded-md border px-3 py-2 text-sm',
            feedback.kind === 'error'
              ? 'border-pgw-status-failed text-pgw-status-failed'
              : 'border-pgw-status-completed text-pgw-status-completed',
          )}
        >
          {feedback.message}
        </div>
      )}
      <div>
        <h3 className="mb-1 text-xs font-medium uppercase text-pgw-muted-fg">Timeline</h3>
        <StepWaterfall run={run} onSelectStep={setSelectedStep} selectedStepId={selectedStep} />
      </div>
      {selectedStepInfo && (
        <section className="flex flex-col gap-3 rounded-md border border-pgw-border p-3">
          <div className="flex items-center justify-between">
            <h3 className="font-mono text-xs font-medium text-pgw-fg">{selectedStepInfo.id}</h3>
            <button
              type="button"
              aria-label="Close step details"
              className="rounded border border-pgw-border px-2 py-0.5 text-xs hover:bg-pgw-muted"
              onClick={() => setSelectedStep(null)}
            >
              Close
            </button>
          </div>
          <div>
            <h4 className="mb-1 text-xs font-medium uppercase text-pgw-muted-fg">Step input</h4>
            <JsonViewer value={selectedStepInfo.stepInput} />
          </div>
          <div>
            <h4 className="mb-1 text-xs font-medium uppercase text-pgw-muted-fg">Step output</h4>
            <JsonViewer value={selectedStepInfo.stepOutput} />
          </div>
        </section>
      )}
      <StepTimeline run={run} />
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="mb-1 text-xs font-medium uppercase text-pgw-muted-fg">Input</h3>
          <JsonViewer value={run.input} />
        </div>
        {run.output != null && (
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase text-pgw-muted-fg">Output</h3>
            <JsonViewer value={run.output} />
          </div>
        )}
        {run.error != null && (
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase text-pgw-status-failed">Error</h3>
            <JsonViewer value={run.error} />
          </div>
        )}
      </section>
    </div>
  );
}
