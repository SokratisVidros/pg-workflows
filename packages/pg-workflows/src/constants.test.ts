import { describe, expect, it } from 'vitest';
import { invokeChildWorkflowTimelineKey, isStepCached } from './constants';

describe('isStepCached', () => {
  it('returns true when output is recorded for stepId', () => {
    expect(isStepCached({ s: { output: 'x', timestamp: new Date() } }, 's')).toBe(true);
  });

  it('returns false when output is undefined', () => {
    expect(isStepCached({ s: { output: undefined, timestamp: new Date() } }, 's')).toBe(false);
  });

  it('returns false when stepId is absent or not an object', () => {
    expect(isStepCached({}, 's')).toBe(false);
    expect(isStepCached({ s: 'not-an-object' }, 's')).toBe(false);
  });

  it('returns true for a bound invokeChildWorkflow step', () => {
    const timeline = {
      [invokeChildWorkflowTimelineKey('s')]: {
        invokeChildWorkflow: { childRunId: 'r', childWorkflowId: 'w' },
      },
    };
    expect(isStepCached(timeline, 's')).toBe(true);
  });
});
