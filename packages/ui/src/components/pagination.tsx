'use client';

import { cn } from '../lib/cn';

export type PaginationProps = {
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  isFetching?: boolean;
  className?: string;
};

export function Pagination({
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  isFetching,
  className,
}: PaginationProps) {
  const btn =
    'rounded border px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 hover:bg-gray-50';
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <button type="button" className={btn} onClick={onPrev} disabled={!hasPrev || isFetching}>
        ‹ Prev
      </button>
      <button type="button" className={btn} onClick={onNext} disabled={!hasNext || isFetching}>
        Next ›
      </button>
    </div>
  );
}
