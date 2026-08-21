'use client';

import type { WorkflowRun } from '../client';
import { cn } from '../lib/cn';
import { computeDurationMs, formatDuration, isTerminalStatus, timeAgo } from '../lib/duration';
import { RunProgress } from './run-progress';
import { StatusBadge } from './status-badge';

export type RunsTableProps = {
  runs: WorkflowRun[];
  onSelectRun: (id: string) => void;
  isLoading?: boolean;
  className?: string;
};

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function durationLabel(run: WorkflowRun): string {
  const ms = computeDurationMs(run);
  return ms == null ? '—' : formatDuration(ms);
}

export function RunsTable({ runs, onSelectRun, isLoading, className }: RunsTableProps) {
  return (
    <table className={cn('w-full border-collapse text-sm', className)}>
      <thead>
        <tr className="border-b border-pgw-border text-left text-xs uppercase text-pgw-muted-fg">
          <th className="px-3 py-2 font-medium">Status</th>
          <th className="px-3 py-2 font-medium">Workflow</th>
          <th className="px-3 py-2 font-medium">Run</th>
          <th className="px-3 py-2 font-medium">Resource</th>
          <th className="px-3 py-2 font-medium">Created</th>
          <th className="px-3 py-2 font-medium">Duration</th>
        </tr>
      </thead>
      <tbody>
        {runs.length === 0 ? (
          <tr>
            <td colSpan={6} className="px-3 py-8 text-center text-pgw-muted-fg">
              {isLoading ? 'Loading…' : 'No runs'}
            </td>
          </tr>
        ) : (
          runs.map((run) => (
            <tr
              key={run.id}
              onClick={() => onSelectRun(run.id)}
              className="cursor-pointer border-b border-pgw-border hover:bg-pgw-muted"
            >
              <td className="px-3 py-2">
                <StatusBadge status={run.status} />
              </td>
              <td className="px-3 py-2">{run.workflowId}</td>
              <td className="px-3 py-2 font-mono text-xs" title={run.id}>
                {shortId(run.id)}
              </td>
              <td className="px-3 py-2 text-pgw-muted-fg">{run.resourceId ?? '—'}</td>
              <td className="px-3 py-2 text-pgw-muted-fg">{timeAgo(run.createdAt)}</td>
              <td className="px-3 py-2 text-pgw-muted-fg">
                {isTerminalStatus(run.status) ? (
                  durationLabel(run)
                ) : (
                  <RunProgress run={run} className="min-w-24" />
                )}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
