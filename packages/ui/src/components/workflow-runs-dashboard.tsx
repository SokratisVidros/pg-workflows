'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { forwardRef, useMemo, useState } from 'react';
import { createFetchClient, type WorkflowRunsClient } from '../client';
import { useRunFilters } from '../hooks/use-run-filters';
import { useWorkflowRunStats } from '../hooks/use-workflow-run-stats';
import { useWorkflowRuns } from '../hooks/use-workflow-runs';
import { applyClientFilters, sortRuns } from '../lib/filters';
import { WorkflowRunsProvider } from '../provider';
import { FilterBar } from './filter-bar/filter-bar';
import { LiveToggle } from './live-toggle';
import { Pagination } from './pagination';
import { RunDetail } from './run-detail/run-detail';
import { RunsTable } from './runs-table';
import { StatusSummary } from './status-summary';

type SelectionProps = {
  selectedRunId?: string | null;
  onSelectRun?: (id: string | null) => void;
  className?: string;
};

export type WorkflowRunsDashboardProps = (
  | { client: WorkflowRunsClient; baseUrl?: never }
  | { baseUrl: string; client?: never }
) & { pollIntervalMs?: number } & SelectionProps;

export const WorkflowRunsDashboard = forwardRef<HTMLDivElement, WorkflowRunsDashboardProps>(
  function WorkflowRunsDashboard(props, ref) {
    // biome-ignore lint/correctness/useExhaustiveDependencies: build the client once per mount
    const client = useMemo(
      () =>
        'client' in props && props.client
          ? props.client
          : createFetchClient({ baseUrl: props.baseUrl as string }),
      [],
    );
    const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    const [live, setLive] = useState(true);
    const pollIntervalMs = props.pollIntervalMs ?? (live ? 5000 : 0);

    return (
      <QueryClientProvider client={qc}>
        <WorkflowRunsProvider client={client} pollIntervalMs={pollIntervalMs}>
          <DashboardInner
            selectedRunId={props.selectedRunId}
            onSelectRun={props.onSelectRun}
            className={props.className}
            live={live}
            onToggleLive={() => setLive((v) => !v)}
            ref={ref}
          />
        </WorkflowRunsProvider>
      </QueryClientProvider>
    );
  },
);

const DashboardInner = forwardRef<
  HTMLDivElement,
  SelectionProps & { live: boolean; onToggleLive: () => void }
>(function DashboardInner({ selectedRunId, onSelectRun, className, live, onToggleLive }, ref) {
  const { filters, setFilters, clearFilters, hasActiveFilters, serverParams } = useRunFilters();
  const runsQuery = useWorkflowRuns(serverParams);
  const statsQuery = useWorkflowRunStats({ workflowId: filters.workflowId });

  const [internalSelected, setInternalSelected] = useState<string | null>(null);
  const selected = selectedRunId !== undefined ? selectedRunId : internalSelected;
  const select = (id: string | null) => {
    if (selectedRunId === undefined) setInternalSelected(id);
    onSelectRun?.(id);
  };

  const items = runsQuery.data?.items ?? [];

  const workflowIds = useMemo(() => {
    const ids = new Set(items.map((r) => r.workflowId));
    return [...ids].sort();
  }, [items]);

  const rows = useMemo(() => {
    const clientFiltered = applyClientFilters(items, {
      datePreset: filters.datePreset,
      durationPreset: filters.durationPreset,
      search: filters.search,
    });
    return sortRuns(clientFiltered, filters.sort, filters.dir);
  }, [items, filters]);

  const list = (
    <>
      {runsQuery.isError ? (
        <div className="rounded-pgw-sm bg-pgw-status-failed/10 px-4 py-3 text-sm font-medium text-pgw-status-failed">
          Failed to load runs.
        </div>
      ) : (
        <RunsTable
          runs={rows}
          onSelectRun={select}
          selectedRunId={selected}
          isLoading={runsQuery.isLoading}
        />
      )}
      <Pagination
        hasPrev={!!runsQuery.data?.hasPrev}
        hasNext={!!runsQuery.data?.hasMore}
        isFetching={runsQuery.isFetching}
        onPrev={() =>
          setFilters({
            endingBefore: runsQuery.data?.prevCursor ?? undefined,
            startingAfter: undefined,
          })
        }
        onNext={() =>
          setFilters({
            startingAfter: runsQuery.data?.nextCursor ?? undefined,
            endingBefore: undefined,
          })
        }
      />
    </>
  );

  const toolbar = (
    <div className="flex flex-col gap-5">
      <LiveToggle
        isLive={live}
        isFetching={runsQuery.isFetching}
        onToggle={onToggleLive}
        className="self-start"
      />
      <StatusSummary
        counts={statsQuery.data ?? {}}
        onSelectStatus={(s) =>
          setFilters({ statuses: [s], startingAfter: undefined, endingBefore: undefined })
        }
      />
      <FilterBar
        filters={filters}
        hasActiveFilters={hasActiveFilters}
        workflowIds={workflowIds}
        onFiltersChange={(p) =>
          setFilters({ ...p, startingAfter: undefined, endingBefore: undefined })
        }
        onClear={clearFilters}
      />
    </div>
  );

  return (
    <div ref={ref} className={clsx('pgw-root @container flex flex-col gap-5', className)}>
      {selected ? (
        <RunDetail
          key={selected}
          runId={selected}
          onBack={() => select(null)}
          className="min-w-0"
        />
      ) : (
        <>
          {toolbar}
          {list}
        </>
      )}
    </div>
  );
});
