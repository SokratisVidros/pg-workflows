'use client';

import { Popover } from '@base-ui/react/popover';
import { ChevronDown } from 'lucide-react';
import { forwardRef, type ReactNode } from 'react';
import { PGW_SELECT } from '../../lib/button-classes';
import { chainClassName, type PartProps } from '../../lib/style-hooks';

export type FilterPopoverParts = {
  positioner?: PartProps<Popover.Positioner.Props>;
  popup?: PartProps<Popover.Popup.Props>;
};

export type FilterPopoverStyleProps = PartProps<Popover.Trigger.Props> & {
  nativeButton?: boolean;
  parts?: FilterPopoverParts;
};

type FilterPopoverProps = {
  label: string;
  /** Appended to the label, e.g. ` (2)` or ` (active)`. */
  suffix?: string;
  active?: boolean;
  children: ReactNode;
} & FilterPopoverStyleProps;

export const FilterPopover = forwardRef<HTMLButtonElement, FilterPopoverProps>(
  function FilterPopover(
    { label, suffix, active, children, className, style, render, nativeButton, parts },
    ref,
  ) {
    return (
      <Popover.Root>
        <Popover.Trigger
          ref={ref}
          data-active={active ? 'true' : undefined}
          nativeButton={nativeButton}
          className={chainClassName(PGW_SELECT, className)}
          style={style}
          render={render}
        >
          <span>
            {label}
            {suffix}
          </span>
          <span className="pgw-caret" aria-hidden>
            <ChevronDown />
          </span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            className={chainClassName('pgw-positioner', parts?.positioner?.className)}
            style={parts?.positioner?.style}
            render={parts?.positioner?.render}
            sideOffset={8}
            align="start"
          >
            <Popover.Popup
              className={chainClassName(
                'pgw-root pgw-popup pgw-popup-pad',
                parts?.popup?.className,
              )}
              style={parts?.popup?.style}
              render={parts?.popup?.render}
            >
              {children}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    );
  },
);
