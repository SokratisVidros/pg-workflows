'use client';

import * as Popover from '@radix-ui/react-popover';
import { ChevronDown } from 'lucide-react';

export type DurationFilterProps = {
  minDuration?: number;
  maxDuration?: number;
  onChange: (next: { minDuration?: number; maxDuration?: number }) => void;
};

export function DurationFilter({ minDuration, maxDuration, onChange }: DurationFilterProps) {
  const active = minDuration != null || maxDuration != null;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-pgw-border px-2 py-1 text-xs hover:bg-pgw-muted"
        >
          Duration{active ? ' (active)' : ''}
          <ChevronDown className="h-3 w-3" />
        </button>
      </Popover.Trigger>
      <Popover.Content
        align="start"
        className="z-50 mt-1 flex flex-col gap-2 rounded-md border border-pgw-border bg-pgw-bg p-2 text-xs shadow-sm"
      >
        <label className="flex flex-col gap-1">
          Min (seconds)
          <input
            type="number"
            min={0}
            value={minDuration ?? ''}
            onChange={(e) =>
              onChange({
                minDuration: e.target.value ? Number(e.target.value) : undefined,
                maxDuration,
              })
            }
          />
        </label>
        <label className="flex flex-col gap-1">
          Max (seconds)
          <input
            type="number"
            min={0}
            value={maxDuration ?? ''}
            onChange={(e) =>
              onChange({
                minDuration,
                maxDuration: e.target.value ? Number(e.target.value) : undefined,
              })
            }
          />
        </label>
      </Popover.Content>
    </Popover.Root>
  );
}
