'use client';

import { Search } from 'lucide-react';

export type SearchFilterProps = {
  value?: string;
  onChange: (next: string | undefined) => void;
};

export function SearchFilter({ value, onChange }: SearchFilterProps) {
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-pgw-border px-2 py-1 text-xs">
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
}
