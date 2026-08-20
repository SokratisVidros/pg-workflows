'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { createFetchClient, type WorkflowRunsClient } from '../client';
import { useRunFilters } from '../hooks/use-run-filters';
import { useWorkflowRuns } from '../hooks/use-workflow-runs';
import { cn } from '../lib/cn';
import { applyClientFilters, sortRuns } from '../lib/filters';
import { WorkflowRunsProvider } from '../provider';
import { FilterBar } from './filter-bar/filter-bar';
import { LiveIndicator } from './live-indicator';
import { Pagination } from './pagination';
import { RunDetail } from './run-detail/run-detail';
import { RunsTable } from './runs-table';

type SelectionProps = {
  selectedRunId?: string | null;
  onSelectRun?: (id: string | null) => void;
  className?: string;
};

export type WorkflowRunsDashboardProps = (
  | { client: WorkflowRunsClient; baseUrl?: never }
  | { baseUrl: string; client?: never }
) & { pollIntervalMs?: number } & SelectionProps;

export function WorkflowRunsDashboard(props: WorkflowRunsDashboardProps) {
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
        <DashboardInner {...props} live={live} onToggleLive={() => setLive((v) => !v)} />
      </WorkflowRunsProvider>
    </QueryClientProvider>
  );
}

function DashboardInner({
  selectedRunId,
  onSelectRun,
  className,
  live,
  onToggleLive,
}: SelectionProps & { live: boolean; onToggleLive: () => void }) {
  const { filters, setFilters, clearFilters, hasActiveFilters, serverParams } = useRunFilters();
  const runsQuery = useWorkflowRuns(serverParams);
  const workflowsQuery = useWorkflowRuns({ limit: 100 });

  const [internalSelected, setInternalSelected] = useState<string | null>(null);
  const selected = selectedRunId !== undefined ? selectedRunId : internalSelected;
  const select = (id: string | null) => {
    if (selectedRunId === undefined) setInternalSelected(id);
    onSelectRun?.(id);
  };

  const workflowIds = useMemo(() => {
    const ids = new Set((workflowsQuery.data?.items ?? []).map((r) => r.workflowId));
    return [...ids].sort();
  }, [workflowsQuery.data]);

  const rows = useMemo(() => {
    const items = runsQuery.data?.items ?? [];
    const clientFiltered = applyClientFilters(items, {
      from: filters.from,
      to: filters.to,
      minDuration: filters.minDuration,
      maxDuration: filters.maxDuration,
      search: filters.search,
    });
    return sortRuns(clientFiltered, filters.sort, filters.dir);
  }, [runsQuery.data, filters]);

  if (selected) {
    return (
      <div className={cn('p-4', className)}>
        <RunDetail runId={selected} onBack={() => select(null)} />
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-3 p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <FilterBar
          filters={filters}
          hasActiveFilters={hasActiveFilters}
          workflowIds={workflowIds}
          onFiltersChange={(p) =>
            setFilters({ ...p, startingAfter: undefined, endingBefore: undefined })
          }
          onClear={clearFilters}
        />
        <LiveIndicator isLive={live} isFetching={runsQuery.isFetching} onToggle={onToggleLive} />
      </div>
      {runsQuery.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          Failed to load runs.
        </div>
      ) : (
        <RunsTable runs={rows} onSelectRun={select} isLoading={runsQuery.isLoading} />
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
    </div>
  );
}
