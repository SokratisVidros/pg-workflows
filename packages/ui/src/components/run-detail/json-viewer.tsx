'use client';

import { Button } from '@base-ui/react/button';
import { clsx } from 'clsx';
import { Check, Copy } from 'lucide-react';
import { forwardRef } from 'react';
import { PGW_BUTTON } from '../../lib/button-classes';
import { type ElementStyleProps, StyledElement } from '../../lib/style-hooks';
import { useCopyText } from '../../lib/use-copy';

export type JsonViewerState = {
  empty: boolean;
  copied: boolean;
};

export type JsonViewerProps = {
  value: unknown;
} & ElementStyleProps<JsonViewerState>;

export const JsonViewer = forwardRef<HTMLElement, JsonViewerProps>(function JsonViewer(
  { value, className, style, render },
  ref,
) {
  const { copied, copy } = useCopyText();
  const styleProps = {
    className,
    style,
    render,
    state: { empty: value === undefined, copied },
  };

  if (value === undefined) {
    return (
      <StyledElement ref={ref} {...styleProps} baseClassName="text-xs text-pgw-muted-fg italic">
        No data
      </StyledElement>
    );
  }

  const pretty = JSON.stringify(value, null, 2);

  return (
    <StyledElement
      ref={ref}
      {...styleProps}
      baseClassName="relative overflow-hidden border border-pgw-border bg-pgw-muted"
    >
      <Button
        type="button"
        aria-label="Copy"
        className={clsx(PGW_BUTTON, 'absolute right-2 top-2')}
        onClick={() => copy(pretty)}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
      <pre className="overflow-x-auto p-4 text-xs leading-relaxed">{pretty}</pre>
    </StyledElement>
  );
});
