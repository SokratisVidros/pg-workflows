'use client';

import { Button } from '@base-ui/react/button';
import { clsx } from 'clsx';
import { forwardRef } from 'react';
import type { RunFilters } from '../../hooks/use-run-filters';
import { PGW_BUTTON } from '../../lib/button-classes';
import { type ElementStyleProps, StyledElement } from '../../lib/style-hooks';
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
} & ElementStyleProps<FilterBarState>;

export type FilterBarState = {
  active: boolean;
};

export const FilterBar = forwardRef<HTMLElement, FilterBarProps>(function FilterBar(
  { filters, hasActiveFilters, workflowIds, onFiltersChange, onClear, className, style, render },
  ref,
) {
  return (
    <StyledElement
      ref={ref}
      state={{ active: hasActiveFilters }}
      className={className}
      style={style}
      render={render}
      baseClassName="pgw-filters"
    >
      <SearchFilter value={filters.search} onChange={(search) => onFiltersChange({ search })} />
      <div className="pgw-filter-pills">
        <div className="pgw-filter-pills-row">
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
          <Button
            type="button"
            onClick={onClear}
            disabled={!hasActiveFilters}
            aria-hidden={hasActiveFilters ? undefined : true}
            tabIndex={hasActiveFilters ? 0 : -1}
            data-inactive={hasActiveFilters ? undefined : ''}
            className={clsx(PGW_BUTTON, 'pgw-clear')}
          >
            Clear
          </Button>
        </div>
      </div>
    </StyledElement>
  );
});
