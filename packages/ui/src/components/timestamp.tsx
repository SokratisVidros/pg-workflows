'use client';

import { Tooltip } from '@base-ui/react/tooltip';
import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import { timeAgo } from '../lib/duration';
import { formatLocalTimestamp, formatUtcTimestamp, toTimestamp } from '../lib/timestamp';

const TICK_MS = 1000;

function TimeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-pgw-muted-fg">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

const listeners = new Set<(now: number) => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: (now: number) => void) {
  listeners.add(listener);
  if (timer === undefined) {
    timer = setInterval(() => {
      const now = Date.now();
      for (const notify of listeners) notify(now);
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => subscribe(setNow), []);
  return now;
}

export type TimestampProps = {
  value: unknown;
  className?: string;
};

export function Timestamp({ value, className }: TimestampProps) {
  const now = useNow();
  const date = toTimestamp(value);
  if (!date) {
    return (
      <span aria-hidden className={clsx('text-pgw-muted-fg/50', className)}>
        —
      </span>
    );
  }

  const relative = timeAgo(date, now);
  const local = formatLocalTimestamp(date);
  const utc = formatUtcTimestamp(date);

  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        delay={300}
        render={
          <span
            suppressHydrationWarning
            className={clsx(
              'inline-block cursor-default underline decoration-dotted decoration-pgw-muted-fg/70 underline-offset-[3px] tabular-nums',
              className,
            )}
          />
        }
        aria-label={`${relative}. Local ${local}. UTC ${utc}.`}
      >
        {relative}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner className="pgw-tooltip-positioner" sideOffset={6}>
          <Tooltip.Popup className="pgw-tooltip">
            <TimeRow label="Local" value={local} />
            <TimeRow label="UTC" value={utc} />
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
