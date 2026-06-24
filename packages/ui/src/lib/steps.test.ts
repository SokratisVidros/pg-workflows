import { describe, expect, it } from 'vitest';
import type { WorkflowRun } from '../client';
import { computeActiveWaitSplitMs, extractSteps, getCompletedStepCount } from './steps';

function makeRun(
  timeline: Record<string, unknown>,
  overrides: Partial<WorkflowRun> = {},
): WorkflowRun {
  return {
    id: 'run_test',
    workflowId: 'demo',
    status: 'running',
    createdAt: '2026-06-17T12:00:00Z',
    completedAt: null,
    pausedAt: null,
    currentStepId: null,
    input: { foo: 'bar' },
    timeline,
    ...overrides,
  } as unknown as WorkflowRun;
}

describe('extractSteps', () => {
  it('returns empty array for empty timeline', () => {
    expect(extractSteps(makeRun({}))).toEqual([]);
  });

  it('extracts completed steps ordered by timestamp', () => {
    const run = makeRun({
      'step-a': { output: { x: 1 }, timestamp: '2026-06-17T12:00:01Z' },
      'step-b': { output: { y: 2 }, timestamp: '2026-06-17T12:00:03Z' },
    });
    const steps = extractSteps(run);
    expect(steps.map((s) => s.id)).toEqual(['step-a', 'step-b']);
    expect(steps[0].status).toBe('completed');
    expect(steps[0].stepInput).toEqual({ foo: 'bar' });
    expect(steps[1].stepInput).toEqual({ x: 1 });
  });

  it('marks current step as running when no output yet', () => {
    const run = makeRun(
      { 'step-a': { output: 'done', timestamp: '2026-06-17T12:00:01Z' } },
      { currentStepId: 'step-b', status: 'running' },
    );
    const steps = extractSteps(run);
    expect(steps).toHaveLength(2);
    expect(steps[1]).toMatchObject({ id: 'step-b', status: 'running' });
  });

  it('identifies wait steps via -wait-for companion entry', () => {
    const run = makeRun({
      'step-a': {
        output: 'done',
        timestamp: '2026-06-17T12:00:05Z',
      },
      'step-a-wait-for': {
        waitFor: { eventName: 'approved' },
        timestamp: '2026-06-17T12:00:00Z',
      },
    });
    const steps = extractSteps(run);
    expect(steps[0].isWaitStep).toBe(true);
  });
});

describe('computeActiveWaitSplitMs', () => {
  it('splits durations by isWaitStep', () => {
    const split = computeActiveWaitSplitMs([
      { id: 'a', status: 'completed', isWaitStep: false, durationMs: 1000, stepInput: null },
      { id: 'b', status: 'completed', isWaitStep: true, durationMs: 4000, stepInput: null },
      { id: 'c', status: 'completed', isWaitStep: false, durationMs: 2000, stepInput: null },
    ]);
    expect(split).toEqual({ activeMs: 3000, waitMs: 4000 });
  });
});

describe('getCompletedStepCount', () => {
  it('counts entries with output', () => {
    const run = makeRun({
      a: { output: 1, timestamp: '2026-06-17T12:00:01Z' },
      b: { output: 2, timestamp: '2026-06-17T12:00:02Z' },
      'b-wait-for': { waitFor: { eventName: 'x' } },
    });
    expect(getCompletedStepCount(run)).toBe(2);
  });
});
