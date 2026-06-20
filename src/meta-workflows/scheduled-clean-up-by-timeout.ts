import type { Db } from 'pg-boss';
import { workflow } from '../definition';
import type { WorkflowEngine } from '../engine';
import type { InputParameters, WorkflowDefinition } from '../types';
import type { ScheduledCleanUpByTimeoutConfig } from '.';

const PAGE = 100;
const DEFAULT_CONFIG = { schedule: '10m', retries: 3, maxPagesPerRun: 10 };

const selectExpiredWorkflowsByTimeoutPage = `
    SELECT id FROM workflow_runs WHERE status IN ('running', 'paused') AND timeout_at < NOW() LIMIT ${PAGE}
`;

/**
 * This meta workflow is registered by the engine's constructor and runs on a schedule.
 * Every time it runs, it checks for workflow runs that have explicit timeout and have been sitting
 * in 'running' or 'paused' but have expired, and sets them to 'failed'.
 */
const scheduledCleanUpByTimeout: (
  e: WorkflowEngine,
  db: Db,
  config?: ScheduledCleanUpByTimeoutConfig,
) => WorkflowDefinition<InputParameters> = (engine, db, config) =>
  workflow(
    '__pgw-scheduled-clean-up-by-timeout',
    async ({ step, logger }) => {
      logger.log(`Scheduled clean up of expired workflows...`);

      const maxPagesPerRun = config?.maxPagesPerRun ?? DEFAULT_CONFIG.maxPagesPerRun;

      let totalCleaned = 0;
      let page = 0;
      let drained = false;

      while (page < maxPagesPerRun) {
        const cleanUpAPageResult = await step.run(`clean-page-${page}`, async () => {
          const expired = await db.executeSql(selectExpiredWorkflowsByTimeoutPage);
          const rows = expired.rows as { id: string }[];
          const ids = rows.map((r) => r.id);

          if (ids.length === 0) return { selected: 0, cleaned: 0 };

          const updated = await db.executeSql(
            `UPDATE workflow_runs
             SET status = 'failed', error = COALESCE(error, 'Workflow run timed out'), updated_at = NOW()
             WHERE id = ANY($1) AND status IN ('running','paused') AND timeout_at < NOW()
             RETURNING id, parent_run_id, parent_step_id, parent_resource_id`,
            [ids],
          );

          const updatedRows = updated.rows as {
            id: string;
            parent_run_id: string | null;
            parent_step_id: string | null;
            parent_resource_id: string | null;
          }[];

          for (const r of updatedRows) {
            if (r.parent_run_id) {
              await engine.notifyParentOfChildTerminalRun({
                id: r.id,
                parentRunId: r.parent_run_id,
                parentStepId: r.parent_step_id,
                parentResourceId: r.parent_resource_id,
              });
            }
          }

          return { selected: ids.length, cleaned: updated.rows.length };
        });

        totalCleaned += cleanUpAPageResult.cleaned;

        if (cleanUpAPageResult.selected < PAGE) {
          drained = true;
          break;
        }

        page++;
      }

      return await step.run('clean-up-done', async () => {
        logger.log(
          `Clean up run finished. Cleaned ${totalCleaned}.` +
            (drained
              ? ''
              : ' Max pages per run limit hit; remaining runs will be cleaned on the next fire.'),
        );

        return { totalCleaned };
      });
    },
    {
      schedule: config?.schedule ?? DEFAULT_CONFIG.schedule,
      retries: config?.retries ?? DEFAULT_CONFIG.retries,
    },
  );

export default scheduledCleanUpByTimeout;
