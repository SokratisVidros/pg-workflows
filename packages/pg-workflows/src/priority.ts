import { WorkflowEngineError } from './error';

/**
 * Named priority levels mapped to pg-boss integer priorities. Higher numbers
 * are fetched first (pg-boss orders by `priority DESC`), and `normal = 0`
 * matches pg-boss's own default. The ±100 spacing leaves room for numeric
 * tuning between tiers via the escape hatch.
 */
export const PRIORITY_LEVELS = { high: 100, normal: 0, low: -100 } as const;

export type WorkflowPriority = keyof typeof PRIORITY_LEVELS | number;

function priorityToInt(value: WorkflowPriority): number {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new WorkflowEngineError(
        `Invalid priority ${value}: numeric priority must be an integer.`,
      );
    }
    return value;
  }

  const mapped = PRIORITY_LEVELS[value];
  if (mapped === undefined) {
    throw new WorkflowEngineError(
      `Invalid priority "${value}": expected one of ${Object.keys(PRIORITY_LEVELS)
        .map((k) => `"${k}"`)
        .join(', ')} or an integer.`,
    );
  }
  return mapped;
}

/**
 * Resolve the effective priority from a precedence chain. The first defined
 * candidate wins (e.g. per-run override, then definition default, then an
 * inherited parent priority); when nothing is defined it falls back to
 * normal (0).
 */
export function resolvePriority(...candidates: (WorkflowPriority | undefined)[]): number {
  for (const candidate of candidates) {
    if (candidate !== undefined) {
      return priorityToInt(candidate);
    }
  }
  return PRIORITY_LEVELS.normal;
}
