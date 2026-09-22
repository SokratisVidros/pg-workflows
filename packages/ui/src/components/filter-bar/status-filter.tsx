'use client';

import { Checkbox } from '@base-ui/react/checkbox';
import { Check } from 'lucide-react';
import { forwardRef, useId } from 'react';
import type { WorkflowRunStatus } from '../../client';
import { WORKFLOW_RUN_STATUSES } from '../../lib/statuses';
import { chainClassName, type PartProps } from '../../lib/style-hooks';
import { FilterPopover, type FilterPopoverStyleProps } from './filter-popover';

export type StatusFilterProps = {
  value: WorkflowRunStatus[];
  onChange: (next: WorkflowRunStatus[]) => void;
  checkbox?: PartProps<Checkbox.Root.Props>;
  indicator?: PartProps<Checkbox.Indicator.Props>;
} & FilterPopoverStyleProps;

export const StatusFilter = forwardRef<HTMLButtonElement, StatusFilterProps>(function StatusFilter(
  { value, onChange, className, style, render, nativeButton, parts, checkbox, indicator },
  ref,
) {
  const id = useId();
  return (
    <FilterPopover
      ref={ref}
      label="Status"
      suffix={value.length > 0 ? ` (${value.length})` : undefined}
      active={value.length > 0}
      className={className}
      style={style}
      render={render}
      nativeButton={nativeButton}
      parts={parts}
    >
      {WORKFLOW_RUN_STATUSES.map((s) => {
        const checked = value.includes(s);
        return (
          <label key={s} htmlFor={`${id}-${s}`} className="pgw-check-label">
            <Checkbox.Root
              id={`${id}-${s}`}
              checked={checked}
              onCheckedChange={() => {
                const next = checked ? value.filter((v) => v !== s) : [...value, s];
                onChange(next);
              }}
              className={chainClassName('pgw-checkbox', checkbox?.className)}
              style={checkbox?.style}
              render={checkbox?.render}
            >
              <Checkbox.Indicator
                className={chainClassName('pgw-checkbox-indicator', indicator?.className)}
                style={indicator?.style}
                render={indicator?.render}
              >
                <Check aria-hidden />
              </Checkbox.Indicator>
            </Checkbox.Root>
            {s}
          </label>
        );
      })}
    </FilterPopover>
  );
});
