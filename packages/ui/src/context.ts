import { createContext } from 'react';
import type { WorkflowRunsClient } from './client';

export type WorkflowRunsContextValue = {
  client: WorkflowRunsClient;
  pollIntervalMs: number;
};

export const WorkflowRunsContext = createContext<WorkflowRunsContextValue | null>(null);
