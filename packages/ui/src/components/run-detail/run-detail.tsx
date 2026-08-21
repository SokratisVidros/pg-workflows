'use client';

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
  'rounded border border-pgw-border px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 hover:bg-pgw-muted';

export function RunDetail({ runId, onBack, className }: RunDetailProps) {
  const { data: run, isLoading, error } = useWorkflowRun(runId);
  const cancel = useCancelRun();
  const pause = usePauseRun();
  const resume = useResumeRun();
  const fastForward = useFastForwardRun();
  const trigger = useTriggerEvent();
  const [selectedStep, setSelectedStep] = useState<string | null>(null);

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
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={actionBtn}
          disabled={terminal || cancel.isPending}
          onClick={() => cancel.mutate({ id: runId })}
        >
          Cancel
        </button>
        <button
          type="button"
          className={actionBtn}
          disabled={run.status !== 'running' || pause.isPending}
          onClick={() => pause.mutate({ id: runId })}
        >
          Pause
        </button>
        <button
          type="button"
          className={actionBtn}
          disabled={run.status !== 'paused' || resume.isPending}
          onClick={() => resume.mutate({ id: runId })}
        >
          Resume
        </button>
        <button
          type="button"
          className={actionBtn}
          disabled={terminal || fastForward.isPending}
          onClick={() => fastForward.mutate({ id: runId })}
        >
          Fast-forward
        </button>
        <button
          type="button"
          className={actionBtn}
          disabled={terminal || trigger.isPending}
          onClick={() => trigger.mutate({ id: runId, eventName: 'resume' })}
        >
          Trigger
        </button>
      </div>
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
