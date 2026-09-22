'use client';

import { clsx } from 'clsx';
import { forwardRef } from 'react';
import type { WorkflowRun } from '../client';
import { extractSteps, getCompletedStepCount } from '../lib/steps';

export type RunProgressProps = {
  run: WorkflowRun;
  className?: string;
};

export const RunProgress = forwardRef<HTMLDivElement, RunProgressProps>(function RunProgress(
  { run, className },
  ref,
) {
  const steps = extractSteps(run);
  const total = steps.length;
  if (total === 0) return null;

  const completed = Math.min(getCompletedStepCount(run), total);
  const pct = (completed / total) * 100;

  return (
    <div ref={ref} className={clsx('flex items-center gap-3', className)}>
      <div className="relative isolate flex min-w-12 flex-1 items-center">
        <div className="absolute inset-x-2 top-1/2 h-1 -translate-y-1/2 rounded-pgw-pill bg-pgw-muted">
          <div className="h-full rounded-pgw-pill bg-pgw-accent" style={{ width: `${pct}%` }} />
        </div>
        <div className="relative z-10 flex w-full items-center justify-between">
          {steps.map((step, i) => {
            const done = i < completed;
            const current = i === completed && completed < total;
            return (
              <span
                key={step.id}
                aria-hidden
                className={clsx(
                  'block size-3.5 rounded-full border-2 border-pgw-card',
                  done || current ? 'bg-pgw-accent' : 'bg-pgw-muted',
                )}
              />
            );
          })}
        </div>
      </div>
      <span className="shrink-0 text-xs font-medium tabular-nums text-pgw-muted-fg">
        {completed}/{total}
      </span>
    </div>
  );
});
