'use client';

import { clsx } from 'clsx';
import { Search } from 'lucide-react';
import { forwardRef } from 'react';
import { PGW_PILL_OUTLINE } from '../../lib/button-classes';

export type SearchFilterProps = {
  value?: string;
  onChange: (next: string | undefined) => void;
  className?: string;
};

export const SearchFilter = forwardRef<HTMLLabelElement, SearchFilterProps>(function SearchFilter(
  { value, onChange, className },
  ref,
) {
  return (
    <label ref={ref} className={clsx(PGW_PILL_OUTLINE, 'pgw-search', className)}>
      <Search aria-hidden />
      <input
        type="text"
        placeholder="Search runs..."
        aria-label="Search runs"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
    </label>
  );
});
