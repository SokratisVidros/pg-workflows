import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowRun } from '../client';
import { RunsTable } from './runs-table';

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

describe('RunsTable', () => {
  it('renders a row per run with workflow id and status', () => {
    render(
      <RunsTable
        runs={[run(), run({ id: 'run_2', workflowId: 'email', status: 'completed' })]}
        onSelectRun={() => {}}
      />,
    );
    expect(screen.getByText('ingest')).toBeInTheDocument();
    expect(screen.getByText('email')).toBeInTheDocument();
  });

  it('calls onSelectRun with the run id when a row is clicked', () => {
    const onSelectRun = vi.fn();
    render(<RunsTable runs={[run({ id: 'run_x' })]} onSelectRun={onSelectRun} />);
    fireEvent.click(screen.getByText('ingest'));
    expect(onSelectRun).toHaveBeenCalledWith('run_x');
  });

  it('shows an empty state when there are no runs', () => {
    render(<RunsTable runs={[]} onSelectRun={() => {}} />);
    expect(screen.getByText(/no runs/i)).toBeInTheDocument();
  });

  it('uses themeable tokens, not hardcoded palette colors', () => {
    const { container } = render(<RunsTable runs={[]} onSelectRun={() => {}} />);
    expect(container.innerHTML).not.toMatch(
      /\b(?:text|bg|border|hover:bg)-(?:gray|red|blue|green|yellow|zinc|slate|neutral)-/,
    );
  });

  it('shows the absolute UTC timestamp as a title on the created cell', () => {
    const createdAt = '2024-03-15T12:34:56.000Z';
    render(<RunsTable runs={[run({ createdAt })]} onSelectRun={() => {}} />);
    expect(screen.getByTitle(new Date(createdAt).toISOString())).toBeInTheDocument();
  });
});
