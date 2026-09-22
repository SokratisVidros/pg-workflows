'use client';

import { forwardRef } from 'react';
import type { WorkflowRunStatus } from '../client';
import { type ElementStyleProps, StyledElement } from '../lib/style-hooks';

export type StatusBadgeState = {
  status: WorkflowRunStatus;
};

export type StatusBadgeProps = {
  status: WorkflowRunStatus;
} & ElementStyleProps<StatusBadgeState>;

export const StatusBadge = forwardRef<HTMLElement, StatusBadgeProps>(function StatusBadge(
  { status, className, style, render },
  ref,
) {
  return (
    <StyledElement
      ref={ref}
      tag="span"
      state={{ status }}
      className={className}
      style={style}
      render={render}
      baseClassName="pgw-badge"
    >
      <span aria-hidden className="size-1.5 bg-pgw-fg" />
      {status}
    </StyledElement>
  );
});
