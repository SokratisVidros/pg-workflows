import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowRun } from '../client';
import { StatusSummary } from './status-summary';

const run = (over: Partial<WorkflowRun> = {}): WorkflowRun =>
  ({
    id: 'run_12345678abc',
    workflowId: 'ingest',
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resourceId: 'tenant_a',
    ...over,
  }) as unknown as WorkflowRun;

describe('StatusSummary', () => {
  it('renders a pill per present status with the correct count', () => {
    render(
      <StatusSummary
        runs={[
          run({ id: 'r1', status: 'running' }),
          run({ id: 'r2', status: 'running' }),
          run({ id: 'r3', status: 'completed' }),
          run({ id: 'r4', status: 'completed' }),
          run({ id: 'r5', status: 'completed' }),
          run({ id: 'r6', status: 'completed' }),
          run({ id: 'r7', status: 'failed' }),
        ]}
      />,
    );
    expect(screen.getByText(/4/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2\s*running/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /4\s*completed/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1\s*failed/i })).toBeInTheDocument();
  });

  it('renders no pill for a status with zero runs', () => {
    render(<StatusSummary runs={[run({ status: 'running' })]} />);
    expect(screen.queryByRole('button', { name: /paused/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /completed/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /failed/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancelled/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /pending/i })).not.toBeInTheDocument();
  });

  it('calls onSelectStatus with the clicked status', () => {
    const onSelectStatus = vi.fn();
    render(
      <StatusSummary
        runs={[run({ status: 'running' }), run({ status: 'failed' })]}
        onSelectStatus={onSelectStatus}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /running/i }));
    expect(onSelectStatus).toHaveBeenCalledWith('running');
    fireEvent.click(screen.getByRole('button', { name: /failed/i }));
    expect(onSelectStatus).toHaveBeenCalledWith('failed');
  });

  it('renders nothing when there are no runs', () => {
    const { container } = render(<StatusSummary runs={[]} />);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('uses themeable tokens, not hardcoded palette colors', () => {
    const { container } = render(
      <StatusSummary runs={[run({ status: 'running' }), run({ status: 'failed' })]} />,
    );
    expect(container.innerHTML).not.toMatch(
      /\b(?:text|bg|border|hover:bg)-(?:gray|red|blue|green|yellow|zinc|slate|neutral)-/,
    );
  });
});
