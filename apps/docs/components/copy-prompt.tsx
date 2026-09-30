'use client';
import { Check, Copy, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { agentPrompt } from '@/lib/site';

/** The site's main call to action: copies the install prompt for a coding agent. */
export function CopyPrompt({ className }: { className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(agentPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className={`not-prose overflow-hidden rounded-xl border bg-fd-card text-left shadow-sm ${className ?? ''}`}
    >
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-fd-primary" aria-hidden />
          Prompt for your coding agent
        </span>
        <span className="hidden text-xs text-fd-muted-foreground sm:inline">
          Claude Code · Cursor · Codex
        </span>
      </div>
      <p className="break-words px-4 py-3 font-mono text-[13px] leading-relaxed text-fd-muted-foreground">
        {agentPrompt}
      </p>
      <div className="flex justify-end border-t bg-fd-muted/40 px-4 py-2.5">
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-2 rounded-lg bg-fd-primary px-3.5 py-2 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
        >
          {copied ? (
            <Check className="size-4" aria-hidden />
          ) : (
            <Copy className="size-4" aria-hidden />
          )}
          {copied ? 'Copied' : 'Copy prompt'}
        </button>
      </div>
    </div>
  );
}
