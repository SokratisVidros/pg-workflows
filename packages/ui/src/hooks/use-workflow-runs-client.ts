'use client';

import { useContext } from 'react';
import { WorkflowRunsContext } from '../context';

export function useWorkflowRunsClient() {
  const ctx = useContext(WorkflowRunsContext);
  if (!ctx) {
    throw new Error('useWorkflowRunsClient must be used inside <WorkflowRunsProvider>');
  }
  return ctx;
}
