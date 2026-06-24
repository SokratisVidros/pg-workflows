'use client'

import * as Select from '@radix-ui/react-select'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/cn'

export type WorkflowIdFilterProps = {
  value?: string
  options: string[]
  onChange: (next: string | undefined) => void
}

export function WorkflowIdFilter({ value, options, onChange }: WorkflowIdFilterProps) {
  return (
    <Select.Root
      value={value ?? '__all__'}
      onValueChange={(v) => onChange(v === '__all__' ? undefined : v)}
    >
      <Select.Trigger
        className={cn(
          'inline-flex items-center gap-1 rounded-md border border-pgw-border px-2 py-1 text-xs hover:bg-pgw-muted',
        )}
      >
        <Select.Value placeholder="All workflows" />
        <Select.Icon>
          <ChevronDown className="h-3 w-3" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="z-50 rounded-md border border-pgw-border bg-pgw-bg p-1 text-xs shadow-sm">
          <Select.Viewport>
            <Select.Item
              value="__all__"
              className="cursor-default rounded px-2 py-1 hover:bg-pgw-muted"
            >
              <Select.ItemText>All workflows</Select.ItemText>
            </Select.Item>
            {options.map((id) => (
              <Select.Item
                key={id}
                value={id}
                className="cursor-default rounded px-2 py-1 hover:bg-pgw-muted"
              >
                <Select.ItemText>{id}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}
