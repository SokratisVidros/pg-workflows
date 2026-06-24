'use client';

import { useCallback, useMemo, useState } from 'react';
import type { WorkflowRunStatus } from '../client';
import type { SortDir, SortKey } from '../lib/filters';

export type RunFilters = {
  limit: number;
  startingAfter?: string;
  endingBefore?: string;
  statuses?: WorkflowRunStatus[];
  workflowId?: string;
  from?: string;
  to?: string;
  minDuration?: number;
  maxDuration?: number;
  search?: string;
  sort: SortKey;
  dir: SortDir;
};

const DEFAULTS: RunFilters = {
  limit: 20,
  sort: 'createdAt',
  dir: 'desc',
};

export function useRunFilters(initial?: Partial<RunFilters>) {
  const [filters, setFiltersState] = useState<RunFilters>({
    ...DEFAULTS,
    ...initial,
  });

  const setFilters = useCallback((partial: Partial<RunFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...partial }));
  }, []);

  const replaceFilters = useCallback((next: RunFilters) => {
    setFiltersState(next);
  }, []);

  const clearFilters = useCallback(() => {
    setFiltersState(DEFAULTS);
  }, []);

  const toggleSort = useCallback((key: SortKey) => {
    setFiltersState((prev) => ({
      ...prev,
      sort: key,
      dir: prev.sort === key && prev.dir === 'desc' ? 'asc' : 'desc',
    }));
  }, []);

  const hasActiveFilters = useMemo(() => {
    return (
      !!filters.statuses?.length ||
      !!filters.workflowId ||
      !!filters.from ||
      !!filters.to ||
      filters.minDuration != null ||
      filters.maxDuration != null ||
      !!filters.search
    );
  }, [filters]);

  const serverParams = useMemo(
    () => ({
      limit: filters.limit,
      startingAfter: filters.startingAfter,
      endingBefore: filters.endingBefore,
      statuses: filters.statuses,
      workflowId: filters.workflowId,
    }),
    [filters],
  );

  return {
    filters,
    setFilters,
    replaceFilters,
    clearFilters,
    toggleSort,
    hasActiveFilters,
    serverParams,
  };
}
