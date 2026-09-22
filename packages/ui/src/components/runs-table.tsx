'use client';

import { clsx } from 'clsx';
import { forwardRef, type KeyboardEvent } from 'react';
import type { WorkflowRun } from '../client';

export type RunsTableProps = {
  runs: WorkflowRun[];
  onSelectRun: (id: string) => void;
  selectedRunId?: string | null;
  isLoading?: boolean;
  className?: string;
};

const EMPTY = '—';

type Column = {
  key: keyof WorkflowRun;
  label: string;
  kind: 'text' | 'id' | 'status' | 'datetime' | 'number';
  sticky?: boolean;
  numeric?: boolean;
};

const COL_WIDTH: Record<Column['kind'], string> = {
  text: 'max-w-[12rem]',
  id: 'max-w-[10rem]',
  status: 'w-[7.25rem]',
  datetime: 'w-[9.25rem]',
  number: 'w-[4.75rem]',
};

function columnBox(column: Column) {
  return clsx(
    'overflow-hidden',
    column.key === 'error' ? 'max-w-[16rem]' : COL_WIDTH[column.kind],
    column.sticky && 'min-w-[9.5rem]',
  );
}

const COLUMNS: Column[] = [
  { key: 'workflowId', label: 'Workflow', kind: 'text', sticky: true },
  { key: 'status', label: 'Status', kind: 'status' },
  { key: 'id', label: 'Run', kind: 'id' },
  { key: 'resourceId', label: 'Resource', kind: 'id' },
  { key: 'currentStepId', label: 'Step', kind: 'text' },
  { key: 'createdAt', label: 'Created', kind: 'datetime' },
  { key: 'completedAt', label: 'Completed', kind: 'datetime' },
  { key: 'error', label: 'Error', kind: 'text' },
  { key: 'retryCount', label: 'Retries', kind: 'number', numeric: true },
  { key: 'priority', label: 'Priority', kind: 'number', numeric: true },
  { key: 'jobId', label: 'Job', kind: 'id' },
];

function isAbsent(value: unknown): boolean {
  return value == null || value === '';
}

function formatTimestamp(value: unknown): { text: string; title: string } | null {
  if (isAbsent(value)) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  const title = date.toISOString();
  return { text: title.slice(0, 16).replace('T', ' '), title };
}

function Cell({
  column,
  value,
  status,
}: {
  column: Column;
  value: unknown;
  status: WorkflowRun['status'];
}) {
  const align = column.numeric ? 'text-right tabular-nums' : 'text-left';
  const base = clsx('block truncate', align);

  if (column.kind === 'datetime') {
    const formatted = formatTimestamp(value);
    if (!formatted) return <Empty className={align} />;
    return (
      <span
        className={clsx(base, 'font-mono text-[0.8125rem] tabular-nums')}
        title={formatted.title}
      >
        {formatted.text}
      </span>
    );
  }

  if (column.kind === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) return <Empty className={align} />;
    return <span className={clsx(base, 'tabular-nums')}>{value}</span>;
  }

  if (column.kind === 'status') {
    const label = String(value ?? '');
    if (!label) return <Empty className={align} />;
    return (
      <span className="inline-flex items-center gap-2">
        <span
          aria-hidden
          className={clsx(
            'size-1.5 shrink-0 rounded-full bg-pgw-fg',
            status === 'pending' || status === 'cancelled' ? 'opacity-40' : 'opacity-100',
          )}
        />
        <span
          className={clsx(
            'capitalize',
            status === 'failed' ? 'font-semibold' : 'font-medium',
            status === 'pending' || status === 'cancelled' ? 'text-pgw-muted-fg' : 'text-pgw-fg',
          )}
        >
          {label}
        </span>
      </span>
    );
  }

  if (isAbsent(value)) return <Empty className={align} />;

  const text = String(value);
  return (
    <span
      className={clsx(
        base,
        column.kind === 'id' && 'font-mono text-[0.8125rem]',
        column.key === 'workflowId' && 'font-semibold',
        column.key === 'error' && 'font-medium',
      )}
      title={text}
    >
      {text}
    </span>
  );
}

function Empty({ className }: { className?: string }) {
  return (
    <span aria-hidden className={clsx('text-pgw-muted-fg/50', className)}>
      {EMPTY}
    </span>
  );
}

function onRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, select: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    select();
  }
}

export const RunsTable = forwardRef<HTMLDivElement, RunsTableProps>(function RunsTable(
  { runs, onSelectRun, selectedRunId, isLoading, className },
  ref,
) {
  if (runs.length === 0) {
    return (
      <div
        ref={ref}
        className={clsx(
          'rounded-pgw-sm border border-pgw-border bg-pgw-card px-4 py-16 text-center text-sm text-pgw-muted-fg',
          className,
        )}
      >
        {isLoading ? 'Loading…' : 'No runs'}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={clsx(
        'min-w-0 overflow-hidden rounded-pgw-sm border border-pgw-border bg-pgw-card',
        className,
      )}
    >
      <div className="pgw-runs-scroll max-h-[min(40rem,70dvh)] overflow-auto">
        <table className="w-max min-w-full border-separate border-spacing-0 text-[0.8125rem] leading-5">
          <caption className="sr-only">Workflow runs</caption>
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={clsx(
                    'sticky top-0 z-10 whitespace-nowrap border-b border-pgw-border bg-pgw-card px-3 py-2 text-[0.6875rem] font-semibold tracking-[0.08em] text-pgw-muted-fg uppercase',
                    column.numeric ? 'text-right' : 'text-left',
                    columnBox(column),
                    column.sticky &&
                      'sticky left-0 z-20 border-r border-pgw-border shadow-[1px_0_0_0_var(--pgw-border)]',
                  )}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const selected = selectedRunId === run.id;
              const select = () => onSelectRun(run.id);
              return (
                <tr
                  key={run.id}
                  tabIndex={0}
                  aria-selected={selected}
                  onClick={select}
                  onKeyDown={(event) => onRowKeyDown(event, select)}
                  className={clsx(
                    'group cursor-pointer transition-colors',
                    'hover:bg-pgw-muted',
                    'focus-visible:bg-pgw-muted focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--pgw-fg)]',
                    selected
                      ? 'bg-pgw-muted shadow-[inset_2px_0_0_0_var(--pgw-fg)]'
                      : 'bg-pgw-card',
                  )}
                >
                  {COLUMNS.map((column) => (
                    <td
                      key={column.key}
                      className={clsx(
                        'whitespace-nowrap border-b border-pgw-border px-3 py-2 align-middle',
                        columnBox(column),
                        column.sticky &&
                          'sticky left-0 bg-pgw-card shadow-[1px_0_0_0_var(--pgw-border)] group-hover:bg-pgw-muted group-focus-visible:bg-pgw-muted group-aria-selected:bg-pgw-muted',
                      )}
                    >
                      <Cell column={column} value={run[column.key]} status={run.status} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});
