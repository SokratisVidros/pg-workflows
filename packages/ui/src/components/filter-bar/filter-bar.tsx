'use client';

import type { RunFilters } from '../../hooks/use-run-filters';
import { DateRangeFilter } from './date-range-filter';
import { DurationFilter } from './duration-filter';
import { SearchFilter } from './search-filter';
import { StatusFilter } from './status-filter';
import { WorkflowIdFilter } from './workflow-id-filter';

export type FilterBarProps = {
  filters: RunFilters;
  hasActiveFilters: boolean;
  workflowIds: string[];
  onFiltersChange: (partial: Partial<RunFilters>) => void;
  onClear: () => void;
};

export function FilterBar({
  filters,
  hasActiveFilters,
  workflowIds,
  onFiltersChange,
  onClear,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusFilter
        value={filters.statuses ?? []}
        onChange={(statuses) =>
          onFiltersChange({ statuses: statuses.length ? statuses : undefined })
        }
      />
      <WorkflowIdFilter
        value={filters.workflowId}
        options={workflowIds}
        onChange={(workflowId) => onFiltersChange({ workflowId })}
      />
      <DateRangeFilter
        from={filters.from}
        to={filters.to}
        onChange={(next) => onFiltersChange(next)}
      />
      <DurationFilter
        minDuration={filters.minDuration}
        maxDuration={filters.maxDuration}
        onChange={(next) => onFiltersChange(next)}
      />
      <SearchFilter value={filters.search} onChange={(search) => onFiltersChange({ search })} />
      {hasActiveFilters && (
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-pgw-muted-fg underline hover:text-pgw-fg"
        >
          Clear
        </button>
      )}
    </div>
  );
}
