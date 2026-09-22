'use client';

import { Input } from '@base-ui/react/input';
import { Search } from 'lucide-react';
import { forwardRef, useId } from 'react';
import {
  chainClassName,
  type ElementStyleProps,
  type PartProps,
  StyledElement,
} from '../../lib/style-hooks';

export type SearchFilterState = {
  filled: boolean;
};

export type SearchFilterProps = {
  value?: string;
  onChange: (next: string | undefined) => void;
  input?: PartProps<Input.Props>;
} & ElementStyleProps<SearchFilterState>;

export const SearchFilter = forwardRef<HTMLElement, SearchFilterProps>(function SearchFilter(
  { value, onChange, className, style, render, input },
  ref,
) {
  const id = useId();
  return (
    <StyledElement
      ref={ref}
      tag="label"
      state={{ filled: Boolean(value) }}
      className={className}
      style={style}
      render={render}
      baseClassName="pgw-search"
      props={{ htmlFor: id }}
    >
      <Search aria-hidden />
      <Input
        id={id}
        type="text"
        placeholder="Search runs..."
        aria-label="Search runs"
        value={value ?? ''}
        onValueChange={(next) => onChange(next || undefined)}
        className={chainClassName('pgw-input', input?.className)}
        style={input?.style}
        render={input?.render}
      />
    </StyledElement>
  );
});
