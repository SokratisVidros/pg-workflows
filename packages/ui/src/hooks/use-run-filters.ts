'use client';

import { useCallback, useMemo, useState } from 'react';
import type { ListRunsParams, WorkflowRunStatus } from '../client';
import type { DatePreset, DurationPreset } from '../lib/filter-presets';
import type { SortDir, SortKey } from '../lib/filters';

export type { DatePreset, DurationPreset };

export type RunFilters = {
  limit: number;
  startingAfter?: string;
  endingBefore?: string;
  statuses?: WorkflowRunStatus[];
  workflowId?: string;
  datePreset?: DatePreset;
  durationPreset?: DurationPreset;
  search?: string;
  sort: SortKey;
  dir: SortDir;
};

const DEFAULTS: RunFilters = {
  limit: 20,
  sort: 'createdAt',
  dir: 'desc',
};

export type UseRunFiltersResult = {
  filters: RunFilters;
  setFilters: (partial: Partial<RunFilters>) => void;
  replaceFilters: (next: RunFilters) => void;
  clearFilters: () => void;
  toggleSort: (key: SortKey) => void;
  hasActiveFilters: boolean;
  serverParams: ListRunsParams;
};

export function useRunFilters(initial?: Partial<RunFilters>): UseRunFiltersResult {
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
      (!!filters.datePreset && filters.datePreset !== 'all') ||
      (!!filters.durationPreset && filters.durationPreset !== 'any') ||
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
