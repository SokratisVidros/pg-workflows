'use client';

import { clsx } from 'clsx';
import { forwardRef } from 'react';
import { PGW_PILL } from '../lib/button-classes';

export type LiveToggleProps = {
  isLive: boolean;
  isFetching: boolean;
  onToggle: () => void;
  className?: string;
};

export const LiveToggle = forwardRef<HTMLButtonElement, LiveToggleProps>(function LiveToggle(
  { isLive, isFetching, onToggle, className },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onToggle}
      aria-pressed={isLive}
      data-fetching={isFetching || undefined}
      className={clsx(PGW_PILL, 'pgw-live', className)}
    >
      {isLive ? 'Live' : 'Paused'}
    </button>
  );
});
