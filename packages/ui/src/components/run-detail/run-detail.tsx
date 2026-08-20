'use client';

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
import { JsonViewer } from './json-viewer';
import { RunDetailHeader } from './run-detail-header';
import { StepTimeline } from './step-timeline';

export type RunDetailProps = {
  runId: string;
  onBack?: () => void;
  className?: string;
};

const actionBtn =
  'rounded border px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 hover:bg-gray-50';

export function RunDetail({ runId, onBack, className }: RunDetailProps) {
  const { data: run, isLoading, error } = useWorkflowRun(runId);
  const cancel = useCancelRun();
  const pause = usePauseRun();
  const resume = useResumeRun();
  const fastForward = useFastForwardRun();
  const trigger = useTriggerEvent();

  if (isLoading) return <div className={cn('p-6 text-gray-500', className)}>Loading…</div>;
  if (error || !run) {
    return (
      <div className={cn('p-6 text-red-600', className)}>
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
      <StepTimeline run={run} />
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="mb-1 text-xs font-medium uppercase text-gray-500">Input</h3>
          <JsonViewer value={run.input} />
        </div>
        {run.output != null && (
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase text-gray-500">Output</h3>
            <JsonViewer value={run.output} />
          </div>
        )}
        {run.error != null && (
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase text-red-500">Error</h3>
            <JsonViewer value={run.error} />
          </div>
        )}
      </section>
    </div>
  );
}
