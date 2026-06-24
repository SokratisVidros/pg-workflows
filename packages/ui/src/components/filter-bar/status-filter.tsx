'use client'

import * as Popover from '@radix-ui/react-popover'
import { ChevronDown } from 'lucide-react'
import type { WorkflowRunStatus } from '../../client'
import { cn } from '../../lib/cn'

const STATUSES: WorkflowRunStatus[] = [
  'pending',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
]

export type StatusFilterProps = {
  value: WorkflowRunStatus[]
  onChange: (next: WorkflowRunStatus[]) => void
}

export function StatusFilter({ value, onChange }: StatusFilterProps) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1 rounded-md border border-pgw-border px-2 py-1 text-xs hover:bg-pgw-muted',
          )}
        >
          Status{value.length > 0 ? ` (${value.length})` : ''}
          <ChevronDown className="h-3 w-3" />
        </button>
      </Popover.Trigger>
      <Popover.Content
        className="z-50 mt-1 min-w-[160px] rounded-md border border-pgw-border bg-pgw-bg p-2 shadow-sm"
        align="start"
      >
        {STATUSES.map((s) => {
          const checked = value.includes(s)
          return (
            <label key={s} className="flex items-center gap-2 px-1 py-0.5 text-xs">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  const next = checked ? value.filter((v) => v !== s) : [...value, s]
                  onChange(next)
                }}
              />
              {s}
            </label>
          )
        })}
      </Popover.Content>
    </Popover.Root>
  )
}
