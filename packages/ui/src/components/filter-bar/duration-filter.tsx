'use client';

import { forwardRef } from 'react';
import { DURATION_PRESETS, type DurationPreset } from '../../lib/filter-presets';
import { type FilterSelectStyleProps, OptionalFilterSelect } from './filter-select';

export type { DurationPreset };

export type DurationFilterProps = {
  value?: DurationPreset;
  onChange: (next: DurationPreset | undefined) => void;
} & FilterSelectStyleProps;

export const DurationFilter = forwardRef<HTMLButtonElement, DurationFilterProps>(
  function DurationFilter({ value, onChange, ...styleProps }, ref) {
    return (
      <OptionalFilterSelect
        ref={ref}
        value={value}
        empty="any"
        items={DURATION_PRESETS}
        onChange={(next) => onChange(next as DurationPreset | undefined)}
        {...styleProps}
      />
    );
  },
);
