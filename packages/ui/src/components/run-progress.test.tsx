import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { WorkflowRun } from '../client';
import { RunProgress } from './run-progress';

function makeRun(
  timeline: Record<string, unknown>,
  overrides: Partial<WorkflowRun> = {},
): WorkflowRun {
  return {
    id: 'run_1',
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

describe('RunProgress', () => {
  it('renders the "completed/total" label and a fill element sized by progress', () => {
    const run = makeRun(
      {
        'step-a': { output: { x: 1 }, timestamp: '2026-06-17T12:00:01Z' },
        'step-b': { output: { y: 2 }, timestamp: '2026-06-17T12:00:02Z' },
      },
      { currentStepId: 'step-c', status: 'running' },
    );
    const { container } = render(<RunProgress run={run} />);
    expect(screen.getByText('2/3')).toBeInTheDocument();
    const fill = container.querySelector('.bg-pgw-accent') as HTMLElement | null;
    expect(fill).toBeInTheDocument();
    expect(fill?.style.width).toBe('66.66666666666666%');
  });

  it('renders nothing when there are no steps', () => {
    const run = makeRun({});
    const { container } = render(<RunProgress run={run} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('uses themeable tokens, not hardcoded palette colors', () => {
    const run = makeRun({
      'step-a': { output: { x: 1 }, timestamp: '2026-06-17T12:00:01Z' },
    });
    const { container } = render(<RunProgress run={run} />);
    expect(container.innerHTML).not.toMatch(
      /\b(?:text|bg|border|hover:bg)-(?:gray|red|blue|green|yellow|zinc|slate|neutral)-/,
    );
  });
});
