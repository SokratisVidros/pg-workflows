import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { workflow } from './definition';
import type { StepBaseContext, WorkflowPlugin } from './types';

describe('workflow definition type safety', () => {
  describe('input schema inference', () => {
    it('infers input type from zod schema', () => {
      workflow(
        'w',
        async ({ input }) => {
          expectTypeOf(input).toEqualTypeOf<{ name: string; age: number }>();
        },
        { inputSchema: z.object({ name: z.string(), age: z.number() }) },
      );
    });

    it('infers nested and complex schemas', () => {
      const schema = z.object({
        user: z.object({ theme: z.enum(['light', 'dark']) }),
        tags: z.array(z.string()),
        optional: z.string().optional(),
      });

      workflow(
        'w',
        async ({ input }) => {
          expectTypeOf(input.user.theme).toEqualTypeOf<'light' | 'dark'>();
          expectTypeOf(input.tags).toEqualTypeOf<string[]>();
          expectTypeOf(input.optional).toEqualTypeOf<string | undefined>();
        },
        { inputSchema: schema },
      );
    });
  });

  describe('step.run', () => {
    it('infers return type from handler', () => {
      workflow('w', async ({ step }) => {
        const obj = await step.run('s1', async () => ({ id: 1 }));
        expectTypeOf(obj).toEqualTypeOf<{ id: number }>();

        const str = await step.run('s2', async () => 'hello');
        expectTypeOf(str).toBeString();

        const nothing = await step.run('s3', async () => {});
        expectTypeOf(nothing).toEqualTypeOf<void>();
      });
    });
  });

  describe('step.waitFor', () => {
    it('infers event data from schema', () => {
      workflow('w', async ({ step }) => {
        const data = await step.waitFor('s', {
          eventName: 'e',
          schema: z.object({ amount: z.number() }),
        });
        expectTypeOf(data).toEqualTypeOf<{ amount: number }>();
      });
    });

    it('returns T | undefined with timeout', () => {
      workflow('w', async ({ step }) => {
        const data = await step.waitFor('s', {
          eventName: 'e',
          timeout: 5000,
          schema: z.object({ ok: z.boolean() }),
        });
        expectTypeOf(data).toEqualTypeOf<{ ok: boolean } | undefined>();
      });
    });
  });

  describe('step.poll', () => {
    it('infers data type from condition function', () => {
      workflow('w', async ({ step }) => {
        const result = await step.poll('s', async () => {
          if (Math.random() > 0.5) return { done: true as const };
          return false;
        });
        expectTypeOf(result).toEqualTypeOf<
          { timedOut: false; data: { done: true } } | { timedOut: true }
        >();
      });
    });
  });

  describe('plugin type accumulation', () => {
    it('extends step context and chains plugins', () => {
      type LogExt = { logStep: (msg: string) => void };
      type CacheExt = { getCache: (key: string) => string };

      const logPlugin: WorkflowPlugin<StepBaseContext, LogExt> = {
        name: 'log',
        methods: () => ({ logStep: () => {} }),
      };
      const cachePlugin: WorkflowPlugin<StepBaseContext & LogExt, CacheExt> = {
        name: 'cache',
        methods: () => ({ getCache: () => '' }),
      };

      workflow.use(logPlugin).use(cachePlugin)('w', async ({ step }) => {
        expectTypeOf(step.run).toBeFunction();
        expectTypeOf(step.logStep).toBeFunction();
        expectTypeOf(step.getCache).toBeFunction();
      });
    });
  });

  describe('input + steps combined', () => {
    it('typed input works alongside step methods and plugins', () => {
      type Ext = { inc: () => number };
      const plugin: WorkflowPlugin<StepBaseContext, Ext> = {
        name: 'ext',
        methods: () => ({ inc: () => 1 }),
      };

      workflow.use(plugin)(
        'w',
        async ({ input, step }) => {
          expectTypeOf(input.action).toEqualTypeOf<'create' | 'delete'>();
          expectTypeOf(step.inc).toBeFunction();

          const r = await step.run('s', async () => ({ ok: true }));
          expectTypeOf(r).toEqualTypeOf<{ ok: boolean }>();
        },
        { inputSchema: z.object({ action: z.enum(['create', 'delete']) }) },
      );
    });
  });
});
