'use client';

import { forwardRef } from 'react';
import { msToSeconds, secondsToMs } from '../../lib/duration';
import { FilterPopover } from './filter-popover';

export type DurationFilterProps = {
  minDurationMs?: number;
  maxDurationMs?: number;
  onChange: (next: { minDurationMs?: number; maxDurationMs?: number }) => void;
  className?: string;
};

export const DurationFilter = forwardRef<HTMLButtonElement, DurationFilterProps>(
  function DurationFilter({ minDurationMs, maxDurationMs, onChange, className }, ref) {
    const active = minDurationMs != null || maxDurationMs != null;
    return (
      <FilterPopover
        ref={ref}
        label="Duration"
        suffix={active ? ' (active)' : undefined}
        className={className}
      >
        <label className="flex flex-col gap-1">
          Min (seconds)
          <input
            type="number"
            min={0}
            value={minDurationMs != null ? msToSeconds(minDurationMs) : ''}
            onChange={(e) =>
              onChange({
                minDurationMs: e.target.value ? secondsToMs(Number(e.target.value)) : undefined,
                maxDurationMs,
              })
            }
          />
        </label>
        <label className="flex flex-col gap-1">
          Max (seconds)
          <input
            type="number"
            min={0}
            value={maxDurationMs != null ? msToSeconds(maxDurationMs) : ''}
            onChange={(e) =>
              onChange({
                minDurationMs,
                maxDurationMs: e.target.value ? secondsToMs(Number(e.target.value)) : undefined,
              })
            }
          />
        </label>
      </FilterPopover>
    );
  },
);
