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
  const total = extractSteps(run).length;
  if (total === 0) return null;

  const completed = Math.min(getCompletedStepCount(run), total);
  const pct = (completed / total) * 100;

  return (
    <div ref={ref} className={clsx('flex items-center gap-2', className)}>
      <div className="h-1.5 w-full min-w-12 flex-1 overflow-hidden rounded-full bg-pgw-muted">
        <div className="h-full rounded-full bg-pgw-accent" style={{ width: `${pct}%` }} />
      </div>
      <span className="shrink-0 text-xs text-pgw-muted-fg">
        {completed}/{total}
      </span>
    </div>
  );
});
