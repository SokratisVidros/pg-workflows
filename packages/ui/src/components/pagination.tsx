'use client';

import { Button } from '@base-ui/react/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { forwardRef } from 'react';
import { PGW_BUTTON } from '../lib/button-classes';
import { type ElementStyleProps, StyledElement } from '../lib/style-hooks';

export type PaginationState = {
  hasPrev: boolean;
  hasNext: boolean;
  fetching: boolean;
};

export type PaginationProps = {
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  isFetching?: boolean;
} & ElementStyleProps<PaginationState>;

export const Pagination = forwardRef<HTMLElement, PaginationProps>(function Pagination(
  { hasPrev, hasNext, onPrev, onNext, isFetching, className, style, render },
  ref,
) {
  return (
    <StyledElement
      ref={ref}
      state={{ hasPrev, hasNext, fetching: Boolean(isFetching) }}
      className={className}
      style={style}
      render={render}
      baseClassName="flex items-center justify-center gap-2"
    >
      <Button
        type="button"
        className={PGW_BUTTON}
        onClick={onPrev}
        disabled={!hasPrev || isFetching}
      >
        <ChevronLeft className="size-3.5" aria-hidden />
        Prev
      </Button>
      <Button
        type="button"
        className={PGW_BUTTON}
        onClick={onNext}
        disabled={!hasNext || isFetching}
      >
        Next
        <ChevronRight className="size-3.5" aria-hidden />
      </Button>
    </StyledElement>
  );
});
