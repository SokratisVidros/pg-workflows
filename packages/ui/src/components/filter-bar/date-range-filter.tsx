'use client';

import { forwardRef } from 'react';
import { FilterPopover } from './filter-popover';

export type DateRangeFilterProps = {
  from?: string;
  to?: string;
  onChange: (next: { from?: string; to?: string }) => void;
  className?: string;
};

export const DateRangeFilter = forwardRef<HTMLButtonElement, DateRangeFilterProps>(
  function DateRangeFilter({ from, to, onChange, className }, ref) {
    const active = !!from || !!to;
    return (
      <FilterPopover
        ref={ref}
        label="Dates"
        suffix={active ? ' (active)' : undefined}
        className={className}
      >
        <label className="flex flex-col gap-1">
          From
          <input
            type="datetime-local"
            value={from ?? ''}
            onChange={(e) => onChange({ from: e.target.value || undefined, to })}
          />
        </label>
        <label className="flex flex-col gap-1">
          To
          <input
            type="datetime-local"
            value={to ?? ''}
            onChange={(e) => onChange({ from, to: e.target.value || undefined })}
          />
        </label>
      </FilterPopover>
    );
  },
);
