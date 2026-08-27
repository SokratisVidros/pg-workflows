import { describe, expect, it } from 'vitest';
import pkg from '../package.json';
import * as client from './client';
import * as ui from './index';

const MAIN_EXPORTS = [
  'createFetchClient',
  'WorkflowRunsProvider',
  'WorkflowRunsDashboard',
  'RunsTable',
  'Pagination',
  'RunDetail',
  'RunProgress',
  'StatusBadge',
  'StatusSummary',
  'LiveToggle',
  'JsonViewer',
  'RunDetailHeader',
  'StepTimeline',
  'FilterBar',
  'StatusFilter',
  'WorkflowIdFilter',
  'DateRangeFilter',
  'DurationFilter',
  'SearchFilter',
  'useWorkflowRuns',
  'useWorkflowRun',
  'useRunFilters',
  'useWorkflowRunsClient',
  'useCancelRun',
  'usePauseRun',
  'useResumeRun',
  'useFastForwardRun',
  'useTriggerEvent',
  'applyClientFilters',
  'sortRuns',
  'formatDuration',
  'timeAgo',
  'computeDurationMs',
  'isTerminalStatus',
] as const;

const INTERNALS = [
  'FilterPopover',
  'FILTER_TRIGGER_CLASS',
  'WorkflowRunsContext',
  'STATUS_TEXT_CLASS',
  'STATUS_DOT_CLASS',
  'extractSteps',
  'runAsOfMs',
  'getCompletedStepCount',
  'computeActiveWaitSplitMs',
] as const;

describe('public API', () => {
  it('exports the curated runtime surface from the main entry', () => {
    for (const name of MAIN_EXPORTS) {
      expect(ui, `missing export: ${name}`).toHaveProperty(name);
    }
  });

  it('does not leak internals', () => {
    for (const name of INTERNALS) {
      expect(name in ui, `leaked export: ${name}`).toBe(false);
    }
  });

  it('keeps the client entry free of React', () => {
    expect(client.createFetchClient).toBeTypeOf('function');
    expect('WorkflowRunsProvider' in client).toBe(false);
    expect('StatusBadge' in client).toBe(false);
    expect('useWorkflowRuns' in client).toBe(false);
    expect('formatDuration' in client).toBe(false);
  });

  it('publishes only the entries that isolate a module graph or non-JS asset', () => {
    expect(Object.keys(pkg.exports).sort()).toEqual(
      [
        '.',
        './client',
        './next',
        './package.json',
        './server',
        './styles.css',
        './tailwind',
      ].sort(),
    );
  });
});
