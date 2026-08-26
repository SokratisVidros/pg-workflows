import { describe, expect, it } from 'vitest';
import type { WorkflowRun } from '../client';
import { applyClientFilters, sortRuns } from './filters';

function makeRuns(): WorkflowRun[] {
  return [
    {
      id: 'run_a',
      workflowId: 'demo',
      status: 'completed',
      createdAt: '2026-06-17T12:00:00Z',
      completedAt: '2026-06-17T12:00:10Z',
      pausedAt: null,
      resourceId: 'kb_xyz',
    },
    {
      id: 'run_b',
      workflowId: 'newsletter',
      status: 'failed',
      createdAt: '2026-06-17T13:00:00Z',
      completedAt: '2026-06-17T13:01:00Z',
      pausedAt: null,
      resourceId: null,
    },
    {
      id: 'run_c',
      workflowId: 'demo',
      status: 'running',
      createdAt: '2026-06-17T14:00:00Z',
      completedAt: null,
      pausedAt: null,
      resourceId: 'kb_other',
    },
  ] as unknown as WorkflowRun[];
}

describe('applyClientFilters', () => {
  it('returns all runs when no filters', () => {
    expect(applyClientFilters(makeRuns(), {})).toHaveLength(3);
  });

  it('filters by from date', () => {
    const result = applyClientFilters(makeRuns(), { from: '2026-06-17T13:30:00Z' });
    expect(result.map((r) => r.id)).toEqual(['run_c']);
  });

  it('filters by search across run id and resource id', () => {
    const result = applyClientFilters(makeRuns(), { search: 'kb_other' });
    expect(result.map((r) => r.id)).toEqual(['run_c']);
  });

  it('filters by min duration in seconds', () => {
    const result = applyClientFilters(makeRuns(), { minDuration: 30 });
    expect(result.map((r) => r.id)).not.toContain('run_a');
  });
});

describe('sortRuns', () => {
  it('sorts by id ascending', () => {
    const sorted = sortRuns(makeRuns(), 'id', 'asc');
    expect(sorted.map((r) => r.id)).toEqual(['run_a', 'run_b', 'run_c']);
  });

  it('sorts by workflowId descending', () => {
    const sorted = sortRuns(makeRuns(), 'workflowId', 'desc');
    expect(sorted[0].workflowId).toBe('newsletter');
  });

  it('is non-mutating', () => {
    const runs = makeRuns();
    sortRuns(runs, 'id', 'desc');
    expect(runs.map((r) => r.id)).toEqual(['run_a', 'run_b', 'run_c']);
  });
});
