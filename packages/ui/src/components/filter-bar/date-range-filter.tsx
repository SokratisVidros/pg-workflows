'use client';

import { forwardRef } from 'react';
import { DATE_PRESETS, type DatePreset } from '../../lib/filter-presets';
import { FilterSelect, FilterSelectItem } from './filter-select';

export type { DatePreset };

export type DateRangeFilterProps = {
  value?: DatePreset;
  onChange: (next: DatePreset | undefined) => void;
  className?: string;
};

export const DateRangeFilter = forwardRef<HTMLButtonElement, DateRangeFilterProps>(
  function DateRangeFilter({ value, onChange, className }, ref) {
    return (
      <FilterSelect
        ref={ref}
        value={value ?? 'all'}
        active={value != null}
        onValueChange={(v) => onChange(v === 'all' ? undefined : (v as DatePreset))}
        className={className}
      >
        {DATE_PRESETS.map((preset) => (
          <FilterSelectItem key={preset.value} value={preset.value}>
            {preset.label}
          </FilterSelectItem>
        ))}
      </FilterSelect>
    );
  },
);
