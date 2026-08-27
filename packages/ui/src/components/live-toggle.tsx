'use client';

import { forwardRef } from 'react';
import { cn } from '../lib/cn';
import { STATUS_DOT_CLASS, STATUS_TEXT_CLASS } from '../lib/status-classes';

/**
 * Deliberately not the shared filter-trigger chrome: this is a live/paused
 * toggle, not a filter, so it is borderless and colours itself by state.
 */
const TOGGLE_CLASS =
  'inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-pgw-muted';

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
      className={cn(TOGGLE_CLASS, className)}
    >
      <span
        aria-hidden
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          isLive
            ? cn(STATUS_DOT_CLASS.completed, isFetching && 'animate-pulse')
            : 'bg-pgw-muted-fg',
        )}
      />
      <span className={isLive ? STATUS_TEXT_CLASS.completed : 'text-pgw-muted-fg'}>
        {isLive ? 'Live' : 'Paused'}
      </span>
    </button>
  );
});
