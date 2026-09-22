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
    currentStepId: 'fetch',
    input: { region: 'emea' },
    output: null,
    error: null,
    timeline: {},
    pausedAt: null,
    resumedAt: null,
    completedAt: null,
    timeoutAt: null,
    retryCount: 0,
    maxRetries: 3,
    priority: 0,
    singleton: false,
    jobId: null,
    idempotencyKey: null,
    parentRunId: null,
    parentStepId: null,
    parentResourceId: null,
    scheduledAt: null,
    ...over,
  }) as unknown as WorkflowRun;

describe('RunsTable', () => {
  it('renders headers for the visible run attributes', () => {
    render(<RunsTable runs={[run()]} onSelectRun={() => {}} />);
    for (const label of [
      'Workflow',
      'Status',
      'Run',
      'Resource',
      'Step',
      'Created',
      'Completed',
      'Error',
      'Retries',
      'Priority',
      'Job',
    ]) {
      expect(screen.getByRole('columnheader', { name: label })).toBeInTheDocument();
    }
    for (const label of [
      'Updated',
      'Input',
      'Output',
      'Paused',
      'Resumed',
      'Timeout',
      'Scheduled',
      'Max retries',
      'Singleton',
      'Idempotency',
      'Parent run',
      'Parent step',
      'Parent resource',
      'Timeline',
    ]) {
      expect(screen.queryByRole('columnheader', { name: label })).not.toBeInTheDocument();
    }
  });

  it('renders a row per run with workflow id and status', () => {
    render(
      <RunsTable
        runs={[run(), run({ id: 'run_2', workflowId: 'email', status: 'completed' })]}
        onSelectRun={() => {}}
      />,
    );
    expect(screen.getByText('ingest')).toBeInTheDocument();
    expect(screen.getByText('email')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
  });

  it('calls onSelectRun with the run id when a row is clicked', () => {
    const onSelectRun = vi.fn();
    render(<RunsTable runs={[run({ id: 'run_x' })]} onSelectRun={onSelectRun} />);
    fireEvent.click(screen.getByText('ingest'));
    expect(onSelectRun).toHaveBeenCalledWith('run_x');
  });

  it('calls onSelectRun when a row is activated from the keyboard', () => {
    const onSelectRun = vi.fn();
    render(<RunsTable runs={[run({ id: 'run_x' })]} onSelectRun={onSelectRun} />);
    fireEvent.keyDown(screen.getByRole('row', { selected: false }), { key: 'Enter' });
    expect(onSelectRun).toHaveBeenCalledWith('run_x');
  });

  it('marks the selected run on its row', () => {
    render(
      <RunsTable
        runs={[run({ id: 'run_x' }), run({ id: 'run_y', workflowId: 'email' })]}
        selectedRunId="run_x"
        onSelectRun={() => {}}
      />,
    );
    expect(screen.getByRole('row', { selected: true })).toHaveTextContent('ingest');
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
    expect(screen.getByText('2024-03-15 12:34')).toBeInTheDocument();
  });

  it('renders absent values as an em dash', () => {
    render(
      <RunsTable
        runs={[run({ completedAt: null, error: null, jobId: null })]}
        onSelectRun={() => {}}
      />,
    );
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
