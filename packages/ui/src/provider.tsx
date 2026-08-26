'use client';

import { type ReactNode, useMemo } from 'react';
import type { WorkflowRunsClient } from './client';
import { WorkflowRunsContext } from './context';

export type WorkflowRunsProviderProps = {
  client: WorkflowRunsClient;
  pollIntervalMs?: number;
  children: ReactNode;
};

export function WorkflowRunsProvider({
  client,
  pollIntervalMs = 5000,
  children,
}: WorkflowRunsProviderProps) {
  const value = useMemo(() => ({ client, pollIntervalMs }), [client, pollIntervalMs]);
  return <WorkflowRunsContext.Provider value={value}>{children}</WorkflowRunsContext.Provider>;
}
