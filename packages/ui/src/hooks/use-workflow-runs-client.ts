'use client';

import { useContext } from 'react';
import { WorkflowRunsContext, type WorkflowRunsContextValue } from '../context';

export function useWorkflowRunsClient(): WorkflowRunsContextValue {
  const ctx = useContext(WorkflowRunsContext);
  if (!ctx) {
    throw new Error('useWorkflowRunsClient must be used inside <WorkflowRunsProvider>');
  }
  return ctx;
}
