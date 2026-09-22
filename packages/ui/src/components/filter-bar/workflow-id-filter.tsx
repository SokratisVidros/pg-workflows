'use client';

import { forwardRef } from 'react';
import { FilterSelect, FilterSelectItem } from './filter-select';

export type WorkflowIdFilterProps = {
  value?: string;
  options: string[];
  onChange: (next: string | undefined) => void;
  className?: string;
};

export const WorkflowIdFilter = forwardRef<HTMLButtonElement, WorkflowIdFilterProps>(
  function WorkflowIdFilter({ value, options, onChange, className }, ref) {
    return (
      <FilterSelect
        ref={ref}
        value={value ?? '__all__'}
        active={value != null}
        onValueChange={(v) => onChange(v === '__all__' ? undefined : v)}
        className={className}
      >
        <FilterSelectItem value="__all__">All workflows</FilterSelectItem>
        {options.map((id) => (
          <FilterSelectItem key={id} value={id}>
            {id}
          </FilterSelectItem>
        ))}
      </FilterSelect>
    );
  },
);
