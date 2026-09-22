'use client';

import { Button } from '@base-ui/react/button';
import { Progress } from '@base-ui/react/progress';
import { Tooltip } from '@base-ui/react/tooltip';
import { clsx } from 'clsx';
import { Check, Copy } from 'lucide-react';
import { forwardRef, type KeyboardEvent } from 'react';
import type { WorkflowRun, WorkflowRunStatus } from '../client';
import { computeDurationMs, formatDuration } from '../lib/duration';
import { extractSteps, getCompletedStepCount } from '../lib/steps';
import { type ElementStyleProps, StyledElement } from '../lib/style-hooks';
import { useCopyText } from '../lib/use-copy';
import { StatusIcon } from './status-icon';
import { Timestamp } from './timestamp';

export type RunsTableState = {
  empty: boolean;
  loading: boolean;
};

export type RunsTableProps = {
  runs: WorkflowRun[];
  onSelectRun: (id: string) => void;
  selectedRunId?: string | null;
  isLoading?: boolean;
} & ElementStyleProps<RunsTableState>;

const EMPTY = '—';

type Column = {
  key: keyof WorkflowRun | 'duration';
  label: string;
  kind: 'text' | 'id' | 'status' | 'datetime' | 'duration';
  sticky?: boolean;
  /** Show the full value and copy it from a button in the cell. */
  copy?: boolean;
};

const COL_WIDTH: Record<Column['kind'], string> = {
  text: 'max-w-[12rem]',
  id: 'max-w-[10rem]',
  status: 'w-[7.25rem]',
  datetime: 'w-[6.75rem]',
  duration: 'w-[5.5rem]',
};

function columnBox(column: Column) {
  if (column.copy) return;
  return clsx('overflow-hidden', COL_WIDTH[column.kind], column.sticky && 'min-w-[9.5rem]');
}

const COLUMNS: Column[] = [
  { key: 'workflowId', label: 'Workflow', kind: 'text', sticky: true },
  { key: 'id', label: 'Run ID', kind: 'id', copy: true },
  { key: 'resourceId', label: 'Resource ID', kind: 'id' },
  { key: 'status', label: 'Status', kind: 'status' },
  { key: 'createdAt', label: 'Started', kind: 'datetime' },
  { key: 'completedAt', label: 'Completed', kind: 'datetime' },
  { key: 'duration', label: 'Duration', kind: 'duration' },
];

function isAbsent(value: unknown): boolean {
  return value == null || value === '';
}

const STEP_PROGRESS_STATUSES = new Set<WorkflowRunStatus>(['running', 'paused', 'failed']);

function stepProgress(run: WorkflowRun): { completed: number; total: number } | null {
  if (!STEP_PROGRESS_STATUSES.has(run.status)) return null;
  const known = extractSteps(run).length;
  const total = Math.max(known, run.totalSteps ?? 0);
  if (total === 0) return null;
  return { completed: Math.min(getCompletedStepCount(run), total), total };
}

function WorkflowStepProgress({ run }: { run: WorkflowRun }) {
  const progress = stepProgress(run);
  if (!progress) return null;

  const { completed, total } = progress;
  const label = `${completed} of ${total} steps`;

  return (
    <Progress.Root
      value={completed}
      max={total}
      aria-label={label}
      getAriaValueText={() => label}
      className="flex min-w-0 items-center gap-1.5"
    >
      <Progress.Track className="pgw-track h-0.5 min-w-0 flex-1">
        <Progress.Indicator className="bg-pgw-fg" />
      </Progress.Track>
      <span aria-hidden className="shrink-0 tabular-nums leading-none text-pgw-muted-fg">
        {completed} of {total}
      </span>
    </Progress.Root>
  );
}

function CopyRunIdButton({ id }: { id: string }) {
  const { copied, copy } = useCopyText();

  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono">{id}</span>
      <Button
        type="button"
        aria-label={copied ? 'Copied run id' : 'Copy run id'}
        className="pointer-events-none inline-flex size-4 shrink-0 items-center justify-center text-pgw-fg opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-pgw-fg"
        onClick={(event) => {
          event.stopPropagation();
          copy(id);
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </Button>
    </span>
  );
}

function Cell({ column, run }: { column: Column; run: WorkflowRun }) {
  if (column.key === 'duration') {
    const ms = computeDurationMs(run);
    if (ms == null) return <Empty />;
    return <span className="tabular-nums">{formatDuration(ms)}</span>;
  }

  const value = run[column.key];

  if (column.copy) {
    if (isAbsent(value)) return <Empty />;
    return <CopyRunIdButton id={String(value)} />;
  }

  const base = 'block truncate text-left';

  if (column.kind === 'datetime') {
    return <Timestamp value={value} />;
  }

  if (column.kind === 'status') {
    const label = String(value ?? '');
    if (!label) return <Empty />;
    return (
      <span className="inline-flex items-center gap-2">
        <StatusIcon status={run.status} />
        <span className="font-medium capitalize text-pgw-fg">{label}</span>
      </span>
    );
  }

  if (isAbsent(value)) return <Empty />;

  const text = String(value);

  if (column.key === 'workflowId') {
    return (
      <span className="flex w-full min-w-0 flex-col gap-1">
        <span className={clsx(base, 'font-semibold')} title={text}>
          {text}
        </span>
        <WorkflowStepProgress run={run} />
      </span>
    );
  }

  return (
    <span className={clsx(base, column.kind === 'id' && 'font-mono')} title={text}>
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

export const RunsTable = forwardRef<HTMLElement, RunsTableProps>(function RunsTable(
  { runs, onSelectRun, selectedRunId, isLoading, className, style, render },
  ref,
) {
  const styleProps = {
    className,
    style,
    render,
    state: { empty: runs.length === 0, loading: Boolean(isLoading) },
  };

  if (runs.length === 0) {
    return (
      <StyledElement
        ref={ref}
        {...styleProps}
        baseClassName="border border-pgw-border bg-pgw-card px-4 py-16 text-center text-sm text-pgw-muted-fg shadow-pgw"
      >
        {isLoading ? 'Loading…' : 'No runs'}
      </StyledElement>
    );
  }

  return (
    <Tooltip.Provider delay={300}>
      <StyledElement
        ref={ref}
        {...styleProps}
        baseClassName="min-w-0 overflow-hidden border border-pgw-border bg-pgw-card shadow-pgw"
      >
        <div className="max-h-[min(40rem,70dvh)] overflow-auto">
          <table className="w-max min-w-full border-separate border-spacing-0 text-xs leading-4">
            <caption className="sr-only">Workflow runs</caption>
            <thead>
              <tr>
                {COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={clsx(
                      'sticky top-0 z-10 whitespace-nowrap border-b border-pgw-border bg-pgw-card px-2 py-2 text-left font-bold text-pgw-fg',
                      columnBox(column),
                      column.sticky && 'sticky left-0 z-20 shadow-[1px_0_0_0_var(--pgw-border)]',
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
                      'hover:bg-pgw-hover',
                      'focus-visible:bg-pgw-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--pgw-focus)]',
                      selected
                        ? 'bg-pgw-hover shadow-[inset_2px_0_0_0_var(--pgw-fg)]'
                        : 'bg-pgw-card',
                    )}
                  >
                    {COLUMNS.map((column) => (
                      <td
                        key={column.key}
                        className={clsx(
                          'whitespace-nowrap border-b border-pgw-border px-2 py-2 align-middle',
                          columnBox(column),
                          column.sticky &&
                            'sticky left-0 bg-pgw-card shadow-[1px_0_0_0_var(--pgw-border)] group-hover:bg-pgw-hover group-focus-visible:bg-pgw-hover group-aria-selected:bg-pgw-hover',
                        )}
                      >
                        <Cell column={column} run={run} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </StyledElement>
    </Tooltip.Provider>
  );
});
