'use client';

import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { forwardRef } from 'react';
import { PGW_PILL_OUTLINE } from '../lib/button-classes';

export type PaginationProps = {
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  isFetching?: boolean;
  className?: string;
};

export const Pagination = forwardRef<HTMLDivElement, PaginationProps>(function Pagination(
  { hasPrev, hasNext, onPrev, onNext, isFetching, className },
  ref,
) {
  return (
    <div ref={ref} className={clsx('flex items-center justify-center gap-2', className)}>
      <button
        type="button"
        className={PGW_PILL_OUTLINE}
        onClick={onPrev}
        disabled={!hasPrev || isFetching}
      >
        <ChevronLeft className="size-3.5" aria-hidden />
        Prev
      </button>
      <button
        type="button"
        className={PGW_PILL_OUTLINE}
        onClick={onNext}
        disabled={!hasNext || isFetching}
      >
        Next
        <ChevronRight className="size-3.5" aria-hidden />
      </button>
    </div>
  );
});
