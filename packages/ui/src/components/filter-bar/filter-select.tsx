'use client';

import * as Select from '@radix-ui/react-select';
import { clsx } from 'clsx';
import { Check } from 'lucide-react';
import { forwardRef, type ReactNode } from 'react';
import { PGW_TEXT } from '../../lib/button-classes';

export type FilterSelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  active?: boolean;
  className?: string;
  children: ReactNode;
};

export const FilterSelect = forwardRef<HTMLButtonElement, FilterSelectProps>(function FilterSelect(
  { value, onValueChange, active, className, children },
  ref,
) {
  return (
    <Select.Root value={value} onValueChange={onValueChange}>
      <Select.Trigger
        ref={ref}
        data-active={active ? 'true' : undefined}
        className={clsx(PGW_TEXT, className)}
      >
        <Select.Value />
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          align="start"
          sideOffset={8}
          className="pgw-root pgw-menu"
        >
          <Select.Viewport>{children}</Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
});

export function FilterSelectItem({ value, children }: { value: string; children: ReactNode }) {
  return (
    <Select.Item
      value={value}
      className="relative flex cursor-default items-center rounded-lg py-1.5 pl-6 pr-2 outline-none data-[highlighted]:bg-pgw-muted"
    >
      <Select.ItemIndicator className="absolute left-1 inline-flex">
        <Check className="size-3" />
      </Select.ItemIndicator>
      <Select.ItemText>{children}</Select.ItemText>
    </Select.Item>
  );
}
