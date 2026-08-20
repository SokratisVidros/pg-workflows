import { describe, expect, it } from 'vitest';
import * as ui from './index';

describe('public API', () => {
  it('exports the dashboard, components, provider, client factory, and hooks', () => {
    for (const name of [
      'WorkflowRunsDashboard',
      'RunsTable',
      'Pagination',
      'RunDetail',
      'StatusBadge',
      'WorkflowRunsProvider',
      'createFetchClient',
      'useWorkflowRuns',
      'useWorkflowRun',
      'useRunFilters',
      'useCancelRun',
      'usePauseRun',
      'useResumeRun',
      'useFastForwardRun',
      'useTriggerEvent',
    ]) {
      expect(ui[name as keyof typeof ui], `missing export: ${name}`).toBeTypeOf('function');
    }
  });
});
