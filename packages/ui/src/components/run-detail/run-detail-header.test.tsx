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
    expect(screen.getByText(/demo/)).toBeInTheDocument();
    expect(screen.getByText(/run_abc/)).toBeInTheDocument();
    expect(screen.getByText(/running/i)).toBeInTheDocument();
  });

  it('shows resource id when present', () => {
    render(<RunDetailHeader run={run} />);
    expect(screen.getByText(/kb_xyz/)).toBeInTheDocument();
  });
});
