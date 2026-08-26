import type { WorkflowRun } from '../client';
import { runAsOfMs } from './duration';

export type StepInfo = {
  id: string;
  status: 'completed' | 'running' | 'waiting' | 'pending' | 'failed';
  durationMs?: number;
  startOffsetMs?: number;
  timestamp?: Date;
  /**
   * True when the step paused execution waiting for an event, a timeout, or a
   * manual resume. Inferred from the engine-written `${stepId}-wait-for`
   * companion entry in the timeline.
   */
  isWaitStep: boolean;
  stepInput: unknown;
  stepOutput?: unknown;
};

type TimelineStepEntry = {
  output?: unknown;
  input?: unknown;
  timestamp?: string | Date;
};

type WaitForTimelineEntry = {
  waitFor?: { eventName?: string; timeoutEvent?: string };
  timestamp?: string | Date;
};

function isWaitForEntry(value: unknown): value is WaitForTimelineEntry {
  return (
    value != null && typeof value === 'object' && 'waitFor' in (value as Record<string, unknown>)
  );
}

function getWaitForEntry(
  timeline: Record<string, unknown>,
  stepId: string,
): WaitForTimelineEntry | undefined {
  const entry = timeline[`${stepId}-wait-for`];
  return isWaitForEntry(entry) ? entry : undefined;
}

function isCompletedTimelineStep(value: unknown): value is TimelineStepEntry & {
  output: unknown;
} {
  if (value == null || typeof value !== 'object') return false;
  const o = value as { output?: unknown };
  return 'output' in value && o.output !== undefined;
}

export function extractSteps(run: WorkflowRun): StepInfo[] {
  const timeline = (run.timeline ?? {}) as Record<string, unknown>;

  const completedRows = Object.entries(timeline)
    .filter(([, v]) => isCompletedTimelineStep(v))
    .map(([id, entry]) => {
      const e = entry as TimelineStepEntry & { output: unknown };
      const ts = e.timestamp ? new Date(e.timestamp) : undefined;
      return { id, entry: e, timestamp: ts };
    });

  completedRows.sort((a, b) => {
    if (!a.timestamp || !b.timestamp) return 0;
    return a.timestamp.getTime() - b.timestamp.getTime();
  });

  const steps: StepInfo[] = completedRows.map((row, i) => {
    const { id, entry, timestamp } = row;
    let stepInput: unknown;
    if (entry.input !== undefined) {
      stepInput = entry.input;
    } else if (i === 0) {
      stepInput = run.input;
    } else {
      const prevEntry = completedRows[i - 1]?.entry;
      stepInput = prevEntry?.output;
    }
    return {
      id,
      status: 'completed' as const,
      timestamp,
      isWaitStep: getWaitForEntry(timeline, id) !== undefined,
      stepInput,
      stepOutput: entry.output,
    };
  });

  const runStartMs = new Date(run.createdAt).getTime();
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;
    const prevStep = i > 0 ? steps[i - 1] : undefined;
    const waitForEntry = getWaitForEntry(timeline, step.id);
    const waitForStartMs = waitForEntry?.timestamp
      ? new Date(waitForEntry.timestamp).getTime()
      : undefined;
    const prevMs = waitForStartMs ?? prevStep?.timestamp?.getTime() ?? runStartMs;
    const currMs = step.timestamp?.getTime();
    step.startOffsetMs = prevMs - runStartMs;
    if (currMs != null) {
      step.durationMs = currMs - prevMs;
    }
  }

  const currentEntry = run.currentStepId ? timeline[run.currentStepId] : undefined;
  const currentHasOutput = currentEntry != null && isCompletedTimelineStep(currentEntry);

  if (run.currentStepId && !currentHasOutput) {
    let status: StepInfo['status'] = 'running';
    if (run.status === 'failed') status = 'failed';
    else if (run.status === 'paused') status = 'waiting';

    const lastStep = steps.length > 0 ? steps[steps.length - 1] : undefined;
    const waitForEntry = getWaitForEntry(timeline, run.currentStepId);
    const waitForStartMs = waitForEntry?.timestamp
      ? new Date(waitForEntry.timestamp).getTime()
      : undefined;
    const lastStepMs = waitForStartMs ?? lastStep?.timestamp?.getTime() ?? runStartMs;
    const endMs = runAsOfMs(run);
    const stepInput = steps.length === 0 ? run.input : lastStep?.stepOutput;

    steps.push({
      id: run.currentStepId,
      status,
      startOffsetMs: lastStepMs - runStartMs,
      durationMs: endMs - lastStepMs,
      isWaitStep: waitForEntry !== undefined,
      stepInput,
      stepOutput: undefined,
    });
  }

  return steps;
}

export function computeActiveWaitSplitMs(steps: StepInfo[]): {
  activeMs: number;
  waitMs: number;
} {
  let activeMs = 0;
  let waitMs = 0;
  for (const step of steps) {
    if (step.durationMs == null) continue;
    if (step.isWaitStep) waitMs += step.durationMs;
    else activeMs += step.durationMs;
  }
  return { activeMs, waitMs };
}

export function getCompletedStepCount(run: WorkflowRun): number {
  const timeline = (run.timeline ?? {}) as Record<string, unknown>;
  let n = 0;
  for (const v of Object.values(timeline)) {
    if (isCompletedTimelineStep(v)) n++;
  }
  return n;
}
