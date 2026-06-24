import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { WorkflowRun } from '../../client';
import { StepTimeline } from './step-timeline';

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

const pausedRun = {
  ...completedRun,
  status: 'paused',
  completedAt: null,
  pausedAt: '2026-06-17T12:00:10Z',
  currentStepId: 'step-c',
  timeline: {
    'step-a': { output: { hello: 'world' }, timestamp: '2026-06-17T12:00:04Z' },
    'step-c-wait-for': { waitFor: { eventName: 'approved' }, timestamp: '2026-06-17T12:00:04Z' },
  },
} as unknown as WorkflowRun;

describe('StepTimeline', () => {
  it('renders one row per step', () => {
    render(<StepTimeline run={completedRun} />);
    expect(screen.getByText('step-a')).toBeInTheDocument();
    expect(screen.getByText('step-b')).toBeInTheDocument();
  });

  it('shows the step-count header', () => {
    render(<StepTimeline run={completedRun} />);
    expect(screen.getByText(/2\/2 steps/i)).toBeInTheDocument();
  });

  it('shows the empty-state when timeline has no entries', () => {
    const empty = { ...completedRun, timeline: {} } as WorkflowRun;
    render(<StepTimeline run={empty} />);
    expect(screen.getByText(/no steps recorded/i)).toBeInTheDocument();
  });

  it('expands a row to reveal input and output', async () => {
    render(<StepTimeline run={completedRun} />);
    const trigger = screen.getByRole('button', { name: /step-a/i });
    await userEvent.click(trigger);
    expect(screen.getByText(/"hello": "world"/)).toBeInTheDocument();
  });

  it('marks a waiting step with a Waited label', () => {
    render(<StepTimeline run={pausedRun} />);
    expect(screen.getByText(/waiting/i)).toBeInTheDocument();
  });
});
