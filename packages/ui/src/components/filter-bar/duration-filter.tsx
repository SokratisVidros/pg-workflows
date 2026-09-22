'use client';

import { forwardRef } from 'react';
import { DURATION_PRESETS, type DurationPreset } from '../../lib/filter-presets';
import { FilterSelect, FilterSelectItem } from './filter-select';

export type { DurationPreset };

export type DurationFilterProps = {
  value?: DurationPreset;
  onChange: (next: DurationPreset | undefined) => void;
  className?: string;
};

export const DurationFilter = forwardRef<HTMLButtonElement, DurationFilterProps>(
  function DurationFilter({ value, onChange, className }, ref) {
    return (
      <FilterSelect
        ref={ref}
        value={value ?? 'any'}
        active={value != null}
        onValueChange={(v) => onChange(v === 'any' ? undefined : (v as DurationPreset))}
        className={className}
      >
        {DURATION_PRESETS.map((preset) => (
          <FilterSelectItem key={preset.value} value={preset.value}>
            {preset.label}
          </FilterSelectItem>
        ))}
      </FilterSelect>
    );
  },
);
