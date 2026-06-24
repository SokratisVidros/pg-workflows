'use client'

import * as Popover from '@radix-ui/react-popover'
import { ChevronDown } from 'lucide-react'

export type DateRangeFilterProps = {
  from?: string
  to?: string
  onChange: (next: { from?: string; to?: string }) => void
}

export function DateRangeFilter({ from, to, onChange }: DateRangeFilterProps) {
  const active = !!from || !!to
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-pgw-border px-2 py-1 text-xs hover:bg-pgw-muted"
        >
          Dates{active ? ' (active)' : ''}
          <ChevronDown className="h-3 w-3" />
        </button>
      </Popover.Trigger>
      <Popover.Content
        align="start"
        className="z-50 mt-1 flex flex-col gap-2 rounded-md border border-pgw-border bg-pgw-bg p-2 text-xs shadow-sm"
      >
        <label className="flex flex-col gap-1">
          From
          <input
            type="datetime-local"
            value={from ?? ''}
            onChange={(e) => onChange({ from: e.target.value || undefined, to })}
          />
        </label>
        <label className="flex flex-col gap-1">
          To
          <input
            type="datetime-local"
            value={to ?? ''}
            onChange={(e) => onChange({ from, to: e.target.value || undefined })}
          />
        </label>
      </Popover.Content>
    </Popover.Root>
  )
}
