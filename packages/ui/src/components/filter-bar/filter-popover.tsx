'use client';

import * as Popover from '@radix-ui/react-popover';
import { clsx } from 'clsx';
import { ChevronDown } from 'lucide-react';
import { forwardRef, type ReactNode } from 'react';

/** Shared chrome for the filter triggers, so spacing/border changes land once. */
export const FILTER_TRIGGER_CLASS =
  'inline-flex items-center gap-1 rounded-md border border-pgw-border px-2 py-1 text-xs hover:bg-pgw-muted';

type FilterPopoverProps = {
  label: string;
  /** Appended to the label, e.g. ` (2)` or ` (active)`. */
  suffix?: string;
  children: ReactNode;
  className?: string;
};

export const FilterPopover = forwardRef<HTMLButtonElement, FilterPopoverProps>(
  function FilterPopover({ label, suffix, children, className }, ref) {
    return (
      <Popover.Root>
        <Popover.Trigger asChild>
          <button type="button" ref={ref} className={clsx(FILTER_TRIGGER_CLASS, className)}>
            {label}
            {suffix ?? ''}
            <ChevronDown className="h-3 w-3" />
          </button>
        </Popover.Trigger>
        <Popover.Content
          align="start"
          className="z-50 mt-1 flex min-w-[160px] flex-col gap-2 rounded-md border border-pgw-border bg-pgw-bg p-2 text-xs shadow-sm"
        >
          {children}
        </Popover.Content>
      </Popover.Root>
    );
  },
);
