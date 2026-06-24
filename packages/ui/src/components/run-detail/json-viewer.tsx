'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/cn';

export type JsonViewerProps = {
  value: unknown;
  className?: string;
};

export function JsonViewer({ value, className }: JsonViewerProps) {
  const [copied, setCopied] = useState(false);

  if (value === undefined) {
    return (
      <div className={cn('text-xs text-pgw-muted-fg italic', className)}>
        No data
      </div>
    );
  }

  const pretty = JSON.stringify(value, null, 2);

  return (
    <div className={cn('relative rounded-md border border-pgw-border bg-pgw-muted', className)}>
      <button
        type="button"
        aria-label="Copy"
        className="absolute right-2 top-2 inline-flex items-center gap-1 rounded border border-pgw-border bg-pgw-bg px-2 py-0.5 text-xs hover:bg-pgw-muted"
        onClick={() => {
          void navigator.clipboard.writeText(pretty);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre className="overflow-x-auto p-3 text-xs">{pretty}</pre>
    </div>
  );
}
