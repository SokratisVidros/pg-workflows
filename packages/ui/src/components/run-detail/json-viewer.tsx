'use client';

import { clsx } from 'clsx';
import { Check, Copy } from 'lucide-react';
import { forwardRef, useState } from 'react';
import { PGW_PILL_OUTLINE } from '../../lib/button-classes';

export type JsonViewerProps = {
  value: unknown;
  className?: string;
};

export const JsonViewer = forwardRef<HTMLDivElement, JsonViewerProps>(function JsonViewer(
  { value, className },
  ref,
) {
  const [copied, setCopied] = useState(false);

  if (value === undefined) {
    return (
      <div ref={ref} className={clsx('text-xs text-pgw-muted-fg italic', className)}>
        No data
      </div>
    );
  }

  const pretty = JSON.stringify(value, null, 2);

  return (
    <div
      ref={ref}
      className={clsx('relative overflow-hidden rounded-pgw-sm bg-pgw-muted', className)}
    >
      <button
        type="button"
        aria-label="Copy"
        className={clsx(PGW_PILL_OUTLINE, 'absolute right-2 top-2 min-h-8 px-3')}
        onClick={() => {
          void navigator.clipboard.writeText(pretty);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre className="overflow-x-auto p-4 text-xs leading-relaxed">{pretty}</pre>
    </div>
  );
});
