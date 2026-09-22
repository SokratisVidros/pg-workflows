import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowRun } from '../client';
import { formatDuration, timeAgo } from '../lib/duration';
import { WORKFLOW_RUN_STATUSES } from '../lib/statuses';
import { formatUtcTimestamp } from '../lib/timestamp';
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
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers).toEqual([
      'Workflow',
      'Run ID',
      'Resource ID',
      'Status',
      'Started',
      'Completed',
      'Duration',
    ]);
    for (const label of [
      'Step',
      'Created',
      'Error',
      'Retries',
      'Priority',
      'Job',
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

  it('shows the full run id as the second column, with a copy button', () => {
    const onSelectRun = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<RunsTable runs={[run()]} onSelectRun={onSelectRun} />);

    const headers = screen.getAllByRole('columnheader');
    expect(headers[0]).toHaveTextContent('Workflow');
    expect(headers[1]).toHaveTextContent('Run ID');
    expect(headers[0].className).toContain('left-0');
    expect(headers[1].className).not.toContain('left-0');

    const runId = screen.getByText('run_12345678abc');
    expect(runId.closest('button')).toBeNull();
    expect(runId.closest('td')).not.toHaveClass('overflow-hidden');
    expect(runId.closest('td')).not.toHaveClass('max-w-[10rem]');

    const copy = screen.getByRole('button', { name: 'Copy run id' });
    expect(copy.className).toContain('opacity-0');
    expect(copy.className).toContain('group-hover:opacity-100');

    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith('run_12345678abc');
    expect(onSelectRun).not.toHaveBeenCalled();
  });

  it('shows step progress under the workflow id while a run is running, paused, or failed', () => {
    const timeline = {
      'step-a': { output: { x: 1 }, timestamp: '2026-06-17T12:00:01Z' },
    };
    render(
      <RunsTable
        runs={[
          run({ id: 'run_running', status: 'running', currentStepId: 'step-b', timeline }),
          run({
            id: 'run_paused',
            workflowId: 'email',
            status: 'paused',
            currentStepId: 'step-b',
            timeline,
          }),
          run({
            id: 'run_failed',
            workflowId: 'import',
            status: 'failed',
            currentStepId: 'step-b',
            timeline,
          }),
          run({
            id: 'run_done',
            workflowId: 'report',
            status: 'completed',
            currentStepId: 'step-a',
            timeline,
          }),
          run({
            id: 'run_cancelled',
            workflowId: 'sync',
            status: 'cancelled',
            currentStepId: 'step-b',
            timeline,
          }),
        ]}
        onSelectRun={() => {}}
      />,
    );

    const bars = screen.getAllByRole('progressbar');
    expect(bars).toHaveLength(3);
    for (const bar of bars) {
      expect(bar).toHaveAccessibleName('1 of 2 steps');
      expect(bar.querySelector('.bg-pgw-fg')).toHaveStyle({ width: '50%' });
    }
    expect(screen.getAllByText('1 of 2')).toHaveLength(3);

    const defined = run({
      id: 'run_defined',
      workflowId: 'catalog-reindex',
      status: 'failed',
      currentStepId: 'plan-shards',
      totalSteps: 3,
      timeline: {
        'plan-shards': { output: { shards: 8 }, timestamp: '2026-06-17T12:00:01Z' },
      },
    });
    render(<RunsTable runs={[defined]} onSelectRun={() => {}} />);
    const definedBar = screen.getByRole('progressbar', { name: '1 of 3 steps' });
    expect(definedBar).toHaveAttribute('aria-valuenow', '1');
    expect(definedBar).toHaveAttribute('aria-valuemax', '3');
    expect(definedBar.querySelector('.bg-pgw-fg')?.getAttribute('style')).toMatch(
      /width:\s*33\.333/,
    );
    expect(
      screen.getByText('report').closest('td')?.querySelector('[role="progressbar"]'),
    ).toBeNull();
    expect(
      screen.getByText('sync').closest('td')?.querySelector('[role="progressbar"]'),
    ).toBeNull();
  });

  it('gives each status a distinct colored mark', () => {
    const { container } = render(
      <RunsTable
        runs={WORKFLOW_RUN_STATUSES.map((status) =>
          run({ id: `run_${status}`, workflowId: status, status }),
        )}
        onSelectRun={() => {}}
      />,
    );

    const marks = WORKFLOW_RUN_STATUSES.map((status) => {
      const icon = container.querySelector(`[data-status-mark="${status}"]`);
      expect(icon).toHaveClass(`text-pgw-status-${status}`);
      expect(icon?.tagName).toBe('svg');
      return icon?.innerHTML;
    });
    expect(new Set(marks).size).toBe(WORKFLOW_RUN_STATUSES.length);
    expect(container.querySelector('[data-status-mark="running"]')).toHaveClass('animate-spin');
    expect(container.innerHTML).not.toMatch(/size-1\.5/);
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

  it('shows a relative time and the local and UTC timestamps on hover', async () => {
    const createdAt = '2024-03-15T12:34:56.000Z';
    const user = userEvent.setup();
    render(<RunsTable runs={[run({ createdAt })]} onSelectRun={() => {}} />);
    const trigger = screen.getByText(timeAgo(createdAt));
    await user.hover(trigger);
    expect(await screen.findByText(formatUtcTimestamp(new Date(createdAt)))).toBeInTheDocument();
    expect(screen.getByText('Local')).toBeInTheDocument();
    expect(screen.getByText('UTC')).toBeInTheDocument();
  });

  it('renders absent values as an em dash', () => {
    render(
      <RunsTable
        runs={[run({ status: 'pending', completedAt: null, resourceId: null })]}
        onSelectRun={() => {}}
      />,
    );
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('formats duration as a short human duration', () => {
    render(
      <RunsTable
        runs={[
          run({
            status: 'completed',
            createdAt: '2026-06-17T12:00:00Z',
            completedAt: '2026-06-17T12:01:05Z',
          }),
        ]}
        onSelectRun={() => {}}
      />,
    );
    expect(screen.getByText(formatDuration(65_000))).toBeInTheDocument();
  });
});
