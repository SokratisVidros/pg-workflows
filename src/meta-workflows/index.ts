import type { Db } from 'pg-boss';
import type { WorkflowEngine } from '../engine';
import type { Schedule } from '../schedule';
import type { InputParameters, WorkflowDefinition } from '../types';
import scheduledCleanUpByTimeout from './scheduled-clean-up-by-timeout';

export enum metaWorkflowsKeys {
  ScheduledCleanUpByTimeout = '__pgw-scheduled-clean-up-by-timeout',
}

export type DefaultWorkflowOptions = {
  configs?: Partial<MetaWorkflowConfigMap>;
  disabled?: metaWorkflowsKeys[];
};

export interface ScheduledCleanUpByTimeoutConfig {
  maxPagesPerRun?: number;
  schedule?: Schedule;
  retries?: number;
}

interface MetaWorkflowConfigMap {
  [metaWorkflowsKeys.ScheduledCleanUpByTimeout]: ScheduledCleanUpByTimeoutConfig;
}

type MetaWorkflowFactory<C> = (
  engine: WorkflowEngine,
  db: Db,
  config?: C,
) => WorkflowDefinition<InputParameters>;

export const metaWorkflows: {
  [K in metaWorkflowsKeys]: MetaWorkflowFactory<MetaWorkflowConfigMap[K]>;
} = {
  '__pgw-scheduled-clean-up-by-timeout': scheduledCleanUpByTimeout,
};

/**
 *
 * @param engine The workflow engine instance
 * @param db The pg-boss db handler
 * @param param2 optional configuration overrides for default workflows
 * @returns Workflows by default registered doing meta work. e.g. scheduled clean up of expired workflow runs
 */
export const defaultWorkflows = (
  engine: WorkflowEngine,
  db: Db,
  { configs = {}, disabled = [] }: DefaultWorkflowOptions = {},
): WorkflowDefinition<InputParameters>[] => {
  const enabled = (Object.keys(metaWorkflows) as metaWorkflowsKeys[]).filter(
    (w) => !disabled.includes(w),
  );

  return enabled.map((k) => metaWorkflows[k](engine, db, configs[k]));
};
