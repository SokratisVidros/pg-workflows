'use client';

import type { WorkflowRun } from '../../client';
import { cn } from '../../lib/cn';
import { computeDurationMs, formatDuration } from '../../lib/duration';
import { extractSteps, type StepInfo } from '../../lib/steps';

const STATUS_BAR: Record<StepInfo['status'], string> = {
  completed: 'bg-pgw-status-completed',
  failed: 'bg-pgw-status-failed',
  running: 'bg-pgw-status-running animate-pulse',
  waiting: 'bg-pgw-status-paused',
  pending: 'bg-pgw-status-pending',
};

function barClassName(step: StepInfo): string {
  if (step.status === 'completed') return STATUS_BAR.completed;
  if (step.status === 'failed') return STATUS_BAR.failed;
  if (step.status === 'running') return STATUS_BAR.running;
  if (step.status === 'waiting' || step.isWaitStep) return STATUS_BAR.waiting;
  return STATUS_BAR.pending;
}

function computeTotalMs(steps: StepInfo[], run: WorkflowRun): number {
  let max = 0;
  for (const step of steps) {
    const end = (step.startOffsetMs ?? 0) + (step.durationMs ?? 0);
    if (end > max) max = end;
  }
  if (max > 0) return max;
  return Math.max(computeDurationMs(run) ?? 1, 1);
}

function WaterfallRow({
  step,
  totalMs,
  onSelectStep,
  selected,
}: {
  step: StepInfo;
  totalMs: number;
  onSelectStep?: (stepId: string) => void;
  selected: boolean;
}) {
  const startOffsetMs = step.startOffsetMs ?? 0;
  const leftPct = (startOffsetMs / totalMs) * 100;
  const rowClassName = cn(
    'flex items-center gap-2 rounded py-1',
    onSelectStep && 'w-full text-left hover:bg-pgw-muted',
    selected && 'bg-pgw-muted',
  );

  const content =
    step.durationMs == null ? (
      <>
        <span className="w-32 shrink-0 truncate font-mono text-xs text-pgw-fg" title={step.id}>
          {step.id}
        </span>
        <span className="relative block h-4 flex-1 rounded bg-pgw-muted">
          <span
            data-waterfall-bar
            className="absolute inset-y-0 w-1 rounded-full bg-pgw-muted-fg opacity-60"
            style={{ left: `${leftPct}%`, width: '0.5%' }}
          />
        </span>
        <span className="w-12 shrink-0 text-right text-xs text-pgw-muted-fg" />
      </>
    ) : (
      <>
        <span className="w-32 shrink-0 truncate font-mono text-xs text-pgw-fg" title={step.id}>
          {step.id}
        </span>
        <span className="relative block h-4 flex-1 rounded bg-pgw-muted">
          <span
            data-waterfall-bar
            className={cn('absolute inset-y-0 rounded', barClassName(step))}
            style={{
              left: `${leftPct}%`,
              width: `${Math.max((step.durationMs / totalMs) * 100, 0.5)}%`,
            }}
          />
        </span>
        <span className="w-12 shrink-0 text-right text-xs text-pgw-muted-fg">
          {formatDuration(step.durationMs)}
        </span>
      </>
    );

  if (onSelectStep) {
    return (
      <button
        type="button"
        aria-pressed={selected}
        className={rowClassName}
        onClick={() => onSelectStep(step.id)}
      >
        {content}
      </button>
    );
  }

  return <div className={rowClassName}>{content}</div>;
}

export type StepWaterfallProps = {
  run: WorkflowRun;
  className?: string;
  onSelectStep?: (stepId: string) => void;
  selectedStepId?: string | null;
};

export function StepWaterfall({
  run,
  className,
  onSelectStep,
  selectedStepId,
}: StepWaterfallProps) {
  const steps = extractSteps(run);

  if (steps.length === 0) {
    return <p className={cn('py-2 text-xs text-pgw-muted-fg', className)}>No steps yet.</p>;
  }

  const totalMs = computeTotalMs(steps, run);

  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      {steps.map((step) => (
        <WaterfallRow
          key={step.id}
          step={step}
          totalMs={totalMs}
          onSelectStep={onSelectStep}
          selected={selectedStepId === step.id}
        />
      ))}
    </div>
  );
}
