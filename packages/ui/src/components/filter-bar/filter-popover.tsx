'use client';

import * as Popover from '@radix-ui/react-popover';
import { clsx } from 'clsx';
import { forwardRef, type ReactNode } from 'react';
import { PGW_TEXT } from '../../lib/button-classes';

type FilterPopoverProps = {
  label: string;
  /** Appended to the label, e.g. ` (2)` or ` (active)`. */
  suffix?: string;
  active?: boolean;
  children: ReactNode;
  className?: string;
};

export const FilterPopover = forwardRef<HTMLButtonElement, FilterPopoverProps>(
  function FilterPopover({ label, suffix, active, children, className }, ref) {
    return (
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            ref={ref}
            data-active={active ? 'true' : undefined}
            className={clsx(PGW_TEXT, className)}
          >
            {label}
            {suffix}
          </button>
        </Popover.Trigger>
        <Popover.Content align="start" sideOffset={8} className="pgw-root pgw-menu">
          {children}
        </Popover.Content>
      </Popover.Root>
    );
  },
);
