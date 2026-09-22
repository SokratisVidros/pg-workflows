'use client';

import { forwardRef, useMemo } from 'react';
import { type FilterSelectStyleProps, OptionalFilterSelect } from './filter-select';

export type WorkflowIdFilterProps = {
  value?: string;
  options: string[];
  onChange: (next: string | undefined) => void;
} & FilterSelectStyleProps;

export const WorkflowIdFilter = forwardRef<HTMLButtonElement, WorkflowIdFilterProps>(
  function WorkflowIdFilter({ value, options, onChange, ...styleProps }, ref) {
    const items = useMemo(
      () => [
        { value: '__all__', label: 'All workflows' },
        ...options.map((id) => ({ value: id, label: id })),
      ],
      [options],
    );

    return (
      <OptionalFilterSelect
        ref={ref}
        value={value}
        empty="__all__"
        items={items}
        onChange={onChange}
        {...styleProps}
      />
    );
  },
);
