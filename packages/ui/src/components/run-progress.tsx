'use client';

import { Progress } from '@base-ui/react/progress';
import { clsx } from 'clsx';
import { forwardRef } from 'react';
import type { WorkflowRun } from '../client';
import { extractSteps, getCompletedStepCount } from '../lib/steps';
import { chainClassName, type PartProps } from '../lib/style-hooks';

export type RunProgressProps = {
  run: WorkflowRun;
  parts?: {
    track?: PartProps<Progress.Track.Props>;
    indicator?: PartProps<Progress.Indicator.Props>;
  };
} & PartProps<Progress.Root.Props>;

export const RunProgress = forwardRef<HTMLDivElement, RunProgressProps>(function RunProgress(
  { run, className, style, render, parts },
  ref,
) {
  const steps = extractSteps(run);
  const total = steps.length;
  if (total === 0) return null;

  const completed = Math.min(getCompletedStepCount(run), total);
  const pct = (completed / total) * 100;

  return (
    <Progress.Root
      ref={ref}
      value={pct}
      className={chainClassName('flex items-center gap-3', className)}
      style={style}
      render={render}
    >
      <div className="relative isolate flex min-w-12 flex-1 items-center">
        <Progress.Track
          className={chainClassName(
            'pgw-track absolute inset-x-2 top-1/2 h-1 -translate-y-1/2',
            parts?.track?.className,
          )}
          style={parts?.track?.style}
          render={parts?.track?.render}
        >
          <Progress.Indicator
            className={chainClassName('bg-pgw-accent', parts?.indicator?.className)}
            style={parts?.indicator?.style}
            render={parts?.indicator?.render}
          />
        </Progress.Track>
        <div className="relative z-10 flex w-full items-center justify-between">
          {steps.map((step, i) => {
            const done = i < completed;
            const current = i === completed && completed < total;
            return (
              <span
                key={step.id}
                aria-hidden
                className={clsx('pgw-step-dot', done || current ? 'is-on' : undefined)}
              />
            );
          })}
        </div>
      </div>
      <span className="shrink-0 text-xs tabular-nums text-pgw-muted-fg">
        {completed}/{total}
      </span>
    </Progress.Root>
  );
});
