import { describe, expect, it } from 'vitest';
import type { WorkflowRun } from '../client';
import { computeDurationMs, formatDuration, isTerminalStatus, timeAgo } from './duration';

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'run_test',
    workflowId: 'demo',
    status: 'running',
    createdAt: new Date('2026-06-17T12:00:00Z').toISOString(),
    completedAt: null,
    pausedAt: null,
    currentStepId: null,
    input: null,
    output: null,
    timeline: {},
    resourceId: null,
    ...overrides,
  } as unknown as WorkflowRun;
}

describe('isTerminalStatus', () => {
  it.each([
    ['completed', true],
    ['failed', true],
    ['cancelled', true],
    ['running', false],
    ['paused', false],
    ['pending', false],
  ])('returns %s -> %s', (status, expected) => {
    expect(isTerminalStatus(status)).toBe(expected);
  });
});

describe('computeDurationMs', () => {
  it('returns null for pending runs', () => {
    expect(computeDurationMs(makeRun({ status: 'pending' }))).toBeNull();
  });

  it('uses completedAt for terminal runs', () => {
    const run = makeRun({
      status: 'completed',
      createdAt: '2026-06-17T12:00:00Z',
      completedAt: '2026-06-17T12:00:05Z',
    });
    expect(computeDurationMs(run)).toBe(5_000);
  });

  it('freezes at pausedAt for paused runs', () => {
    const run = makeRun({
      status: 'paused',
      createdAt: '2026-06-17T12:00:00Z',
      pausedAt: '2026-06-17T12:00:03Z',
    });
    expect(computeDurationMs(run)).toBe(3_000);
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [12_000, '12s'],
    [65_000, '1m 5s'],
    [3_600_000, '1h'],
    [3_660_000, '1h 1m'],
  ])('formats %i ms as %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe('timeAgo', () => {
  it('formats seconds', () => {
    const t = new Date(Date.now() - 30_000);
    expect(timeAgo(t)).toBe('30s ago');
  });

  it('formats minutes', () => {
    const t = new Date(Date.now() - 5 * 60_000);
    expect(timeAgo(t)).toBe('5m ago');
  });
});
