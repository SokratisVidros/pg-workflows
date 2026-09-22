'use client';

import { Toggle } from '@base-ui/react/toggle';
import { forwardRef } from 'react';
import { PGW_BUTTON } from '../lib/button-classes';
import { chainClassName, type PartProps } from '../lib/style-hooks';

export type LiveToggleProps = {
  isLive: boolean;
  isFetching: boolean;
  onToggle: () => void;
  nativeButton?: boolean;
} & PartProps<Toggle.Props<string>>;

export const LiveToggle = forwardRef<HTMLButtonElement, LiveToggleProps>(function LiveToggle(
  { isLive, isFetching, onToggle, className, style, render, nativeButton },
  ref,
) {
  return (
    <Toggle
      ref={ref}
      pressed={isLive}
      onPressedChange={() => onToggle()}
      data-fetching={isFetching || undefined}
      nativeButton={nativeButton}
      className={chainClassName(`${PGW_BUTTON} pgw-live`, className)}
      style={style}
      render={render}
    >
      {isLive ? 'Live' : 'Paused'}
    </Toggle>
  );
});
