'use client';

import { forwardRef } from 'react';
import { DATE_PRESETS, type DatePreset } from '../../lib/filter-presets';
import { type FilterSelectStyleProps, OptionalFilterSelect } from './filter-select';

export type { DatePreset };

export type DateRangeFilterProps = {
  value?: DatePreset;
  onChange: (next: DatePreset | undefined) => void;
} & FilterSelectStyleProps;

export const DateRangeFilter = forwardRef<HTMLButtonElement, DateRangeFilterProps>(
  function DateRangeFilter({ value, onChange, ...styleProps }, ref) {
    return (
      <OptionalFilterSelect
        ref={ref}
        value={value}
        empty="all"
        items={DATE_PRESETS}
        onChange={(next) => onChange(next as DatePreset | undefined)}
        {...styleProps}
      />
    );
  },
);
