'use client';

import { clsx } from 'clsx';
import { forwardRef } from 'react';
import type { RunFilters } from '../../hooks/use-run-filters';
import { PGW_PILL } from '../../lib/button-classes';
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
    <div ref={ref} className={clsx('pgw-filters', className)}>
      <SearchFilter value={filters.search} onChange={(search) => onFiltersChange({ search })} />
      <div className="pgw-filter-pills flex flex-col items-start gap-2 @min-[40rem]:ps-4">
        <div className="pgw-filter-pills-row flex flex-wrap items-center gap-x-8 gap-y-2">
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
            value={filters.datePreset}
            onChange={(datePreset) => onFiltersChange({ datePreset })}
          />
          <DurationFilter
            value={filters.durationPreset}
            onChange={(durationPreset) => onFiltersChange({ durationPreset })}
          />
        </div>
        {hasActiveFilters && (
          <button type="button" onClick={onClear} className={PGW_PILL}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
});
