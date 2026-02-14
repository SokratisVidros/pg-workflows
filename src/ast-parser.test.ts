import type { PgBoss } from 'pg-boss';
import { beforeAll, describe, expect, it } from 'vitest';
import { workflow } from './definition';
import { WorkflowEngine } from './engine';
import { getBoss } from './tests/pgboss';
import { createTestDatabase } from './tests/test-db';
import { StepType } from './types';

let testBoss: PgBoss;

// Setup test database and boss for all tests
beforeAll(async () => {
  const testDb = await createTestDatabase();
  testBoss = await getBoss(testDb);
});

describe('AST Parser for Workflow Steps', () => {
  it('should parse simple workflow with static step names', async () => {
    const simpleWorkflow = workflow('simple-workflow', async ({ step }) => {
      await step.run('step-1', async () => 'result-1');
      await step.waitFor('step-2', { eventName: 'user-action' });
      await step.pause('step-3');
      await step.run('step-4', async () => 'result-4');
      return 'completed';
    });

    const engine = new WorkflowEngine({ boss: testBoss });
    await engine.registerWorkflow(simpleWorkflow);

    expect(engine.workflows.get('simple-workflow')?.steps).toEqual([
      {
        id: 'step-1',
        type: StepType.RUN,
        conditional: false,
        loop: false,
        isDynamic: false,
      },
      {
        id: 'step-2',
        type: StepType.WAIT_FOR,
        conditional: false,
        loop: false,
        isDynamic: false,
      },
      {
        id: 'step-3',
        type: StepType.PAUSE,
        conditional: false,
        loop: false,
        isDynamic: false,
      },
      {
        id: 'step-4',
        type: StepType.RUN,
        conditional: false,
        loop: false,
        isDynamic: false,
      },
    ]);
  });

  it('should detect conditional steps', async () => {
    const conditionalWorkflow = workflow('conditional-workflow', async ({ step, input }) => {
      await step.run('step-1', async () => 'result-1');

      if (input.condition) {
        await step.run('conditional-step', async () => 'conditional-result');
      }

      await step.run('step-3', async () => 'result-3');
      return 'completed';
    });

    const engine = new WorkflowEngine({ boss: testBoss });
    await engine.registerWorkflow(conditionalWorkflow);

    expect(engine.workflows.get('conditional-workflow')?.steps).toEqual([
      {
        id: 'step-1',
        type: StepType.RUN,
        conditional: false,
        loop: false,
        isDynamic: false,
      },
      {
        id: 'conditional-step',
        type: StepType.RUN,
        conditional: true,
        loop: false,
        isDynamic: false,
      },
      {
        id: 'step-3',
        type: StepType.RUN,
        conditional: false,
        loop: false,
        isDynamic: false,
      },
    ]);
  });

  it('should detect loop steps', async () => {
    const loopWorkflow = workflow('loop-workflow', async ({ step }) => {
      await step.run('step-1', async () => 'result-1');

      for (let i = 0; i < 3; i++) {
        await step.run(`loop-step-${i}`, async () => `result-${i}`);
      }

      await step.run('step-3', async () => 'result-3');
      return 'completed';
    });

    const engine = new WorkflowEngine({ boss: testBoss });
    await engine.registerWorkflow(loopWorkflow);

    expect(engine.workflows.get('loop-workflow')?.steps).toEqual([
      {
        id: 'step-1',
        type: StepType.RUN,
        conditional: false,
        loop: false,
        isDynamic: false,
      },
      {
        id: `loop-step-\${...}`,
        type: StepType.RUN,
        conditional: false,
        loop: true,
        isDynamic: true,
      },
      {
        id: 'step-3',
        type: StepType.RUN,
        conditional: false,
        loop: false,
        isDynamic: false,
      },
    ]);
  });

  it('should handle workflow with waitFor and pause steps', async () => {
    const mixedStepWorkflow = workflow('mixed-step-workflow', async ({ step }) => {
      await step.run('step-1', async () => 'result-1');
      await step.waitFor('step-2', { eventName: 'user-action' });
      await step.pause('step-3');
      await step.run('step-4', async () => 'result-4');
      return 'completed';
    });

    const engine = new WorkflowEngine({ boss: testBoss });
    await engine.registerWorkflow(mixedStepWorkflow);
  });

  it('should handle nested conditionals and loops', async () => {
    const nestedWorkflow = workflow('nested-workflow', async ({ step, input }) => {
      await step.run('start', async () => 'started');

      for (let i = 0; i < input.outerCount; i++) {
        if (i % 2 === 0) {
          await step.run(`even-${i}`, async () => `even-result-${i}`);

          for (let j = 0; j < 2; j++) {
            await step.run(`nested-${i}-${j}`, async () => `nested-result-${i}-${j}`);
          }
        } else {
          await step.run(`odd-${i}`, async () => `odd-result-${i}`);
        }
      }

      await step.run('end', async () => 'ended');
      return 'completed';
    });

    const engine = new WorkflowEngine({ boss: testBoss });
    await engine.registerWorkflow(nestedWorkflow);
  });

  it('should handle switch statements', async () => {
    const switchWorkflow = workflow('switch-workflow', async ({ step, input }) => {
      await step.run('step-1', async () => 'result-1');

      switch (input.type) {
        case 'A':
          await step.run('handle-a', async () => 'handled-a');
          break;
        case 'B':
          await step.run('handle-b', async () => 'handled-b');
          break;
        default:
          await step.run('handle-default', async () => 'handled-default');
      }

      await step.run('step-3', async () => 'result-3');
      return 'completed';
    });

    const engine = new WorkflowEngine({ boss: testBoss });
    await engine.registerWorkflow(switchWorkflow);
  });

  it('should throw error for duplicate static step IDs', async () => {
    const duplicateWorkflow = workflow('duplicate-workflow', async ({ step }) => {
      await step.run('step-1', async () => 'result-1');
      await step.run('step-2', async () => 'result-2');
      await step.run('step-1', async () => 'duplicate-result');
      return 'completed';
    });

    const engine = new WorkflowEngine({ boss: testBoss });

    await expect(engine.registerWorkflow(duplicateWorkflow)).rejects.toThrow(
      "Duplicate step ID detected: 'step-1'. Step IDs must be unique within a workflow.",
    );
  });

  it('should throw error for duplicate step IDs in dynamic steps', async () => {
    const duplicateDynamicWorkflow = workflow('duplicate-dynamic-workflow', async ({ step }) => {
      await step.run('process-item', async () => 'result-1');

      const items = ['a', 'b'];
      for (const item of items) {
        await step.run('process-item', async () => `result-${item}`);
      }

      return 'completed';
    });

    const engine = new WorkflowEngine({ boss: testBoss });

    await expect(engine.registerWorkflow(duplicateDynamicWorkflow)).rejects.toThrow(
      "Duplicate step ID detected: 'process-item'. Step IDs must be unique within a workflow.",
    );
  });
});
