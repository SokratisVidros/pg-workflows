import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowRun } from '../../client';
import { StepWaterfall } from './step-waterfall';

const NO_RAW_PALETTE =
  /\b(?:text|bg|border|hover:bg)-(?:gray|red|blue|green|yellow|zinc|slate|neutral)-/;

const completedRun = {
  id: 'run_x',
  workflowId: 'demo',
  status: 'completed',
  createdAt: '2026-06-17T12:00:00Z',
  completedAt: '2026-06-17T12:00:10Z',
  pausedAt: null,
  currentStepId: null,
  input: { kickoff: true },
  output: { ok: true },
  timeline: {
    'step-a': { output: { hello: 'world' }, timestamp: '2026-06-17T12:00:04Z' },
    'step-b': { output: { done: true }, timestamp: '2026-06-17T12:00:09Z' },
  },
} as unknown as WorkflowRun;

describe('StepWaterfall', () => {
  it('renders a row per step with its id', () => {
    render(<StepWaterfall run={completedRun} />);
    expect(screen.getByText('step-a')).toBeInTheDocument();
    expect(screen.getByText('step-b')).toBeInTheDocument();
  });

  it('renders a positioned bar with left/width inline style percentages', () => {
    const { container } = render(<StepWaterfall run={completedRun} />);
    const bars = container.querySelectorAll<HTMLElement>('[data-waterfall-bar]');
    expect(bars.length).toBe(2);
    for (const bar of bars) {
      expect(bar.style.left).toMatch(/%$/);
      expect(bar.style.width).toMatch(/%$/);
    }
  });

  it('does not use raw palette classes anywhere in the markup', () => {
    const { container } = render(<StepWaterfall run={completedRun} />);
    expect(container.innerHTML).not.toMatch(NO_RAW_PALETTE);
  });

  it('shows the empty state when there are no steps', () => {
    const empty = { ...completedRun, timeline: {} } as WorkflowRun;
    render(<StepWaterfall run={empty} />);
    expect(screen.getByText(/no steps yet/i)).toBeInTheDocument();
  });

  it('calls onSelectStep with the step id when a row is clicked', () => {
    const onSelectStep = vi.fn();
    render(<StepWaterfall run={completedRun} onSelectStep={onSelectStep} />);
    fireEvent.click(screen.getByRole('button', { name: /step-a/i }));
    expect(onSelectStep).toHaveBeenCalledWith('step-a');
  });

  it('marks the selected row with aria-pressed', () => {
    const onSelectStep = vi.fn();
    render(
      <StepWaterfall run={completedRun} onSelectStep={onSelectStep} selectedStepId="step-b" />,
    );
    expect(screen.getByRole('button', { name: /step-b/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /step-a/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('does not render rows as buttons when onSelectStep is not provided', () => {
    render(<StepWaterfall run={completedRun} />);
    expect(screen.queryByRole('button', { name: /step-a/i })).not.toBeInTheDocument();
  });
});
