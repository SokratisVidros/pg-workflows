'use client';

import { clsx } from 'clsx';
import { Check, ChevronRight, Circle, Loader2, Pause, X } from 'lucide-react';
import { forwardRef, useState } from 'react';
import type { WorkflowRun } from '../../client';
import { computeDurationMs, formatDuration } from '../../lib/duration';
import {
  computeActiveWaitSplitMs,
  extractSteps,
  getCompletedStepCount,
  type StepInfo,
} from '../../lib/steps';
import { JsonViewer } from './json-viewer';

const STATUS_BAR: Record<string, string> = {
  completed: 'bg-pgw-status-completed',
  running: 'bg-pgw-status-running animate-pulse',
  waiting: 'bg-pgw-status-paused',
  failed: 'bg-pgw-status-failed',
  pending: 'bg-pgw-muted-fg',
};

const WAIT_HATCH_STYLE: React.CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(45deg, color-mix(in oklab, var(--pgw-status-paused) 85%, transparent) 0 6px, color-mix(in oklab, var(--pgw-status-paused) 35%, transparent) 6px 12px)',
};

function StepDot({ status }: { status: StepInfo['status'] }) {
  const common = 'flex h-3 w-3 items-center justify-center rounded-full';
  switch (status) {
    case 'completed':
      return (
        <div className={clsx(common, 'bg-pgw-status-completed')}>
          <Check className="h-1.5 w-1.5 text-white" />
        </div>
      );
    case 'running':
      return (
        <div className={clsx(common, 'bg-pgw-status-running')}>
          <Loader2 className="h-1.5 w-1.5 animate-spin text-white" />
        </div>
      );
    case 'waiting':
      return (
        <div className={clsx(common, 'bg-pgw-status-paused')}>
          <Pause className="h-1.5 w-1.5 fill-white text-white" />
        </div>
      );
    case 'failed':
      return (
        <div className={clsx(common, 'bg-pgw-status-failed')}>
          <X className="h-1.5 w-1.5 text-white" />
        </div>
      );
    default:
      return (
        <div className={clsx(common, 'bg-pgw-muted-fg')}>
          <Circle className="h-1.5 w-1.5 text-white" />
        </div>
      );
  }
}

function WaterfallBar({ step, totalDurationMs }: { step: StepInfo; totalDurationMs: number }) {
  if (totalDurationMs <= 0) return <div className="h-4" />;
  const leftPct = step.startOffsetMs != null ? (step.startOffsetMs / totalDurationMs) * 100 : 0;
  const widthPct =
    step.durationMs != null
      ? Math.max(1, (step.durationMs / totalDurationMs) * 100)
      : step.status === 'running' || step.status === 'waiting'
        ? Math.max(1, ((totalDurationMs - (step.startOffsetMs ?? 0)) / totalDurationMs) * 100)
        : 0;
  const useHatch = step.isWaitStep;
  return (
    <div className="relative h-4 w-full rounded bg-pgw-muted">
      <div
        className={clsx(
          'absolute inset-y-0 rounded',
          useHatch ? undefined : STATUS_BAR[step.status],
        )}
        style={{
          left: `${leftPct}%`,
          width: `${widthPct}%`,
          ...(useHatch ? WAIT_HATCH_STYLE : {}),
        }}
      />
    </div>
  );
}

function StepRow({ step, totalDurationMs }: { step: StepInfo; totalDurationMs: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1 py-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-0 items-start gap-2 rounded-md py-0.5 text-left hover:bg-pgw-muted/40"
      >
        <div className="flex min-w-0 shrink-0 items-start gap-1.5" style={{ width: '45%' }}>
          <div className="relative mt-0.5">
            <StepDot status={step.status} />
          </div>
          <ChevronRight
            aria-hidden
            className={clsx(
              'mt-0.5 h-3.5 w-3.5 shrink-0 text-pgw-muted-fg transition-transform duration-200',
              open && 'rotate-90',
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-1.5">
              <span className="truncate font-mono text-xs">{step.id}</span>
              {step.durationMs != null && (
                <span
                  className={clsx(
                    'shrink-0 text-[10px]',
                    step.status === 'waiting' ? 'text-pgw-status-paused' : 'text-pgw-muted-fg',
                  )}
                >
                  {step.status === 'waiting' ? 'Waited ' : ''}
                  {formatDuration(step.durationMs)}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <WaterfallBar step={step} totalDurationMs={totalDurationMs} />
        </div>
      </button>
      {open && (
        <div className="space-y-2 pb-1 pl-[calc(1rem+0.375rem+0.875rem+0.375rem)] pt-0.5">
          <div className="text-[10px] uppercase tracking-wide text-pgw-muted-fg">Input</div>
          <JsonViewer value={step.stepInput} />
          <div className="text-[10px] uppercase tracking-wide text-pgw-muted-fg">Output</div>
          <JsonViewer value={step.stepOutput} />
        </div>
      )}
    </div>
  );
}

export type StepTimelineProps = {
  run: WorkflowRun;
  className?: string;
};

export const StepTimeline = forwardRef<HTMLDivElement, StepTimelineProps>(function StepTimeline(
  { run, className },
  ref,
) {
  const steps = extractSteps(run);
  const completedCount = getCompletedStepCount(run);
  const totalDurationMs = computeDurationMs(run) ?? 0;
  const { activeMs, waitMs } = computeActiveWaitSplitMs(steps);
  const splitSumMs = activeMs + waitMs;
  const showSplit = totalDurationMs > 0 && waitMs > 0 && splitSumMs > 0;
  const activePct = showSplit ? (activeMs / splitSumMs) * 100 : 0;
  const waitPct = showSplit ? (waitMs / splitSumMs) * 100 : 0;

  return (
    <div ref={ref} className={clsx('space-y-0', className)}>
      <div className="mb-3 flex items-center justify-between text-xs text-pgw-muted-fg">
        <span>
          {completedCount}/{steps.length} steps
        </span>
        <span
          className={clsx(
            run.status === 'paused' && 'inline-flex items-center gap-1 text-pgw-status-paused',
          )}
        >
          {run.status === 'paused' && <Pause className="h-3 w-3 fill-current" />}
          {run.status === 'paused' && run.currentStepId
            ? `Waiting on ${run.currentStepId}`
            : run.status}
        </span>
      </div>

      <div className="mb-1 flex items-center gap-2">
        <div
          className="flex shrink-0 flex-col gap-0.5 text-xs font-medium"
          style={{ width: '45%' }}
        >
          <div className="flex items-center gap-1.5">
            Total
            {totalDurationMs > 0 && (
              <span className="text-pgw-muted-fg">{formatDuration(totalDurationMs)}</span>
            )}
          </div>
          {showSplit && (
            <span className="text-[10px] font-normal text-pgw-muted-fg">
              {formatDuration(activeMs)} active - {formatDuration(waitMs)} waited
            </span>
          )}
        </div>
        <div className="relative h-5 flex-1 overflow-hidden rounded bg-pgw-muted">
          {showSplit ? (
            <>
              <div
                className="absolute inset-y-0 left-0 bg-pgw-status-running"
                style={{ width: `${activePct}%` }}
              />
              <div
                className="absolute inset-y-0"
                style={{ left: `${activePct}%`, width: `${waitPct}%`, ...WAIT_HATCH_STYLE }}
              />
            </>
          ) : (
            <div
              className={clsx(
                'absolute inset-y-0 left-0 rounded',
                STATUS_BAR[run.status] ?? 'bg-pgw-muted-fg',
              )}
              style={{ width: totalDurationMs > 0 ? '100%' : '0%' }}
            />
          )}
        </div>
      </div>

      <div className="mb-1 border-b border-pgw-border" />

      {steps.length > 0 ? (
        steps.map((step) => <StepRow key={step.id} step={step} totalDurationMs={totalDurationMs} />)
      ) : (
        <p className="py-2 text-xs text-pgw-muted-fg">No steps recorded yet.</p>
      )}
    </div>
  );
});
