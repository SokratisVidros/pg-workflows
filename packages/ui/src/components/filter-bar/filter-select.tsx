'use client';

import { Select } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import { forwardRef } from 'react';
import { PGW_SELECT } from '../../lib/button-classes';
import { chainClassName, type PartProps } from '../../lib/style-hooks';

export type FilterSelectParts = {
  positioner?: PartProps<Select.Positioner.Props>;
  popup?: PartProps<Select.Popup.Props>;
  list?: PartProps<Select.List.Props>;
  item?: PartProps<Select.Item.Props>;
  icon?: PartProps<Select.Icon.Props>;
  scrollUpArrow?: PartProps<Select.ScrollUpArrow.Props>;
  scrollDownArrow?: PartProps<Select.ScrollDownArrow.Props>;
};

export type FilterSelectStyleProps = PartProps<Select.Trigger.Props> & {
  nativeButton?: boolean;
  parts?: FilterSelectParts;
};

export type FilterOption = {
  value: string;
  label: string;
};

export type FilterSelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  items: readonly FilterOption[];
  active?: boolean;
} & FilterSelectStyleProps;

export type OptionalFilterSelectProps = {
  value?: string;
  /** Sentinel stored while the filter is unset, e.g. `all` or `__all__`. */
  empty: string;
  items: readonly FilterOption[];
  onChange: (next: string | undefined) => void;
} & FilterSelectStyleProps;

/** Select whose empty sentinel maps back to `undefined`. */
export const OptionalFilterSelect = forwardRef<HTMLButtonElement, OptionalFilterSelectProps>(
  function OptionalFilterSelect({ value, empty, items, onChange, ...styleProps }, ref) {
    return (
      <FilterSelect
        ref={ref}
        value={value ?? empty}
        items={items}
        active={value != null}
        onValueChange={(next) => onChange(next === empty ? undefined : next)}
        {...styleProps}
      />
    );
  },
);

export const FilterSelect = forwardRef<HTMLButtonElement, FilterSelectProps>(function FilterSelect(
  { value, onValueChange, items, active, className, style, render, nativeButton, parts },
  ref,
) {
  return (
    <Select.Root
      items={items}
      value={value}
      onValueChange={(next) => {
        if (typeof next === 'string') onValueChange(next);
      }}
    >
      <Select.Trigger
        ref={ref}
        data-active={active ? 'true' : undefined}
        nativeButton={nativeButton}
        className={chainClassName(PGW_SELECT, className)}
        style={style}
        render={render}
      >
        <Select.Value />
        <Select.Icon
          className={chainClassName('pgw-caret', parts?.icon?.className)}
          style={parts?.icon?.style}
          render={parts?.icon?.render}
        >
          <ChevronDown aria-hidden />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          className={chainClassName('pgw-positioner', parts?.positioner?.className)}
          style={parts?.positioner?.style}
          render={parts?.positioner?.render}
          sideOffset={4}
          alignItemWithTrigger={false}
        >
          <Select.Popup
            className={chainClassName('pgw-root pgw-popup', parts?.popup?.className)}
            style={parts?.popup?.style}
            render={parts?.popup?.render}
          >
            <Select.ScrollUpArrow
              className={chainClassName('pgw-scroll-arrow', parts?.scrollUpArrow?.className)}
              style={parts?.scrollUpArrow?.style}
              render={parts?.scrollUpArrow?.render}
            >
              <ChevronDown aria-hidden className="rotate-180" />
            </Select.ScrollUpArrow>
            <Select.List
              className={chainClassName('pgw-list', parts?.list?.className)}
              style={parts?.list?.style}
              render={parts?.list?.render}
            >
              {items.map((item) => (
                <Select.Item
                  key={item.value}
                  value={item.value}
                  className={chainClassName('pgw-option', parts?.item?.className)}
                  style={parts?.item?.style}
                  render={parts?.item?.render}
                >
                  <Select.ItemIndicator className="pgw-option-indicator">
                    <Check aria-hidden />
                  </Select.ItemIndicator>
                  <Select.ItemText>{item.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
            <Select.ScrollDownArrow
              className={chainClassName('pgw-scroll-arrow', parts?.scrollDownArrow?.className)}
              style={parts?.scrollDownArrow?.style}
              render={parts?.scrollDownArrow?.render}
            >
              <ChevronDown aria-hidden />
            </Select.ScrollDownArrow>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
});
