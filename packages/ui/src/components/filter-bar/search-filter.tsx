'use client';

import { clsx } from 'clsx';
import { Search } from 'lucide-react';
import { forwardRef } from 'react';

export type SearchFilterProps = {
  value?: string;
  onChange: (next: string | undefined) => void;
  className?: string;
};

export const SearchFilter = forwardRef<HTMLDivElement, SearchFilterProps>(function SearchFilter(
  { value, onChange, className },
  ref,
) {
  return (
    <div
      ref={ref}
      className={clsx(
        'inline-flex items-center gap-1 rounded-md border border-pgw-border px-2 py-1 text-xs',
        className,
      )}
    >
      <Search className="h-3 w-3 text-pgw-muted-fg" />
      <input
        type="text"
        placeholder="Search runs..."
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="bg-transparent outline-none placeholder:text-pgw-muted-fg"
      />
    </div>
  );
});
