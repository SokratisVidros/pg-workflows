'use client';

import { useEffect, useRef, useState } from 'react';

/** Copy text and keep a short-lived "copied" flag for button feedback. */
export function useCopyText(resetMs = 1500) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => window.clearTimeout(timer.current);
  }, []);

  function copy(text: string) {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), resetMs);
  }

  return { copied, copy };
}
