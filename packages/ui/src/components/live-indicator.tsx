'use client';

import { cn } from '../lib/cn';

export type LiveIndicatorProps = {
  isLive: boolean;
  isFetching: boolean;
  onToggle: () => void;
  className?: string;
};

export function LiveIndicator({ isLive, isFetching, onToggle, className }: LiveIndicatorProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isLive}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-pgw-muted',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          isLive ? cn('bg-pgw-status-completed', isFetching && 'animate-pulse') : 'bg-pgw-muted-fg',
        )}
      />
      <span className={isLive ? 'text-pgw-status-completed' : 'text-pgw-muted-fg'}>
        {isLive ? 'Live' : 'Paused'}
      </span>
    </button>
  );
}
