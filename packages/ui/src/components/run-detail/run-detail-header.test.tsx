import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RunDetailHeader } from './run-detail-header';

const run = {
  id: 'run_abc',
  workflowId: 'demo',
  status: 'running',
  createdAt: '2026-06-17T12:00:00Z',
  completedAt: null,
  pausedAt: null,
  resourceId: 'kb_xyz',
} as never;

describe('RunDetailHeader', () => {
  it('shows workflow id, run id, status, and duration', () => {
    render(<RunDetailHeader run={run} />);
    const workflowId = screen.getByTitle('demo');
    expect(workflowId).toHaveClass('truncate');
    expect(screen.getByRole('heading', { name: 'run_abc' })).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('keeps the status mark on the workflow id line, with progress before it when the run is not completed', () => {
    const { container } = render(
      <RunDetailHeader
        run={
          {
            ...run,
            currentStepId: 'step-b',
            timeline: {
              'step-a': { output: { x: 1 }, timestamp: '2026-06-17T12:00:01Z' },
            },
          } as never
        }
      />,
    );
    const row = screen.getByTitle('demo').parentElement;
    const icon = container.querySelector('[data-status-mark="running"]');
    const progress = screen.getByRole('progressbar');
    expect(row).toContainElement(icon as HTMLElement);
    expect(row).toContainElement(progress);
    expect(progress.compareDocumentPosition(icon as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(progress.parentElement).toHaveClass('order-last', '@min-[40rem]:order-0');
  });

  it('hides the progress bar for a completed run', () => {
    render(
      <RunDetailHeader
        run={
          {
            ...run,
            status: 'completed',
            timeline: {
              'step-a': { output: { x: 1 }, timestamp: '2026-06-17T12:00:01Z' },
            },
          } as never
        }
      />,
    );
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows resource id when present', () => {
    render(<RunDetailHeader run={run} />);
    expect(screen.getAllByText(/kb_xyz/).length).toBeGreaterThan(0);
  });

  it('lays run details out in one column that becomes three when the header is wide', () => {
    render(<RunDetailHeader run={run} />);
    const meta = screen.getByText('Priority').parentElement?.parentElement;
    expect(meta).toHaveClass('grid-cols-1', '@min-[40rem]:grid-cols-3');
    expect(screen.getByText('Retries')).toBeInTheDocument();
    expect(screen.getByText('Job')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Run details' })).not.toBeInTheDocument();
  });
});
