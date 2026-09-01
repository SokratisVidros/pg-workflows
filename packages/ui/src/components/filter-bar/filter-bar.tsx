'use client';

import { clsx } from 'clsx';
import { forwardRef } from 'react';
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
  className?: string;
};

export const FilterBar = forwardRef<HTMLDivElement, FilterBarProps>(function FilterBar(
  { filters, hasActiveFilters, workflowIds, onFiltersChange, onClear, className },
  ref,
) {
  return (
    <div ref={ref} className={clsx('flex flex-wrap items-center gap-2', className)}>
      <SearchFilter value={filters.search} onChange={(search) => onFiltersChange({ search })} />
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
        minDurationMs={filters.minDurationMs}
        maxDurationMs={filters.maxDurationMs}
        onChange={(next) => onFiltersChange(next)}
      />
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
});
