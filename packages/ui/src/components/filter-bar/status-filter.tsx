'use client';

import { forwardRef } from 'react';
import type { WorkflowRunStatus } from '../../client';
import { FilterPopover } from './filter-popover';

const STATUSES: WorkflowRunStatus[] = [
  'pending',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
];

export type StatusFilterProps = {
  value: WorkflowRunStatus[];
  onChange: (next: WorkflowRunStatus[]) => void;
  className?: string;
};

export const StatusFilter = forwardRef<HTMLButtonElement, StatusFilterProps>(function StatusFilter(
  { value, onChange, className },
  ref,
) {
  return (
    <FilterPopover
      ref={ref}
      label="Status"
      suffix={value.length > 0 ? ` (${value.length})` : undefined}
      className={className}
    >
      {STATUSES.map((s) => {
        const checked = value.includes(s);
        return (
          <label key={s} className="flex items-center gap-2 px-1 py-0.5 text-xs">
            <input
              type="checkbox"
              checked={checked}
              onChange={() => {
                const next = checked ? value.filter((v) => v !== s) : [...value, s];
                onChange(next);
              }}
            />
            {s}
          </label>
        );
      })}
    </FilterPopover>
  );
});
