import { CronExpressionParser } from 'cron-parser';
import { type Duration, MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, parseDuration } from './duration';
import { WorkflowEngineError } from './error';

const CRON_TOKEN = /^[0-9*/,?\-LW#]+$/;

export type Schedule = string | Exclude<Duration, string>;

type ResolvedSchedule = {
  cron: string;
  timezone: string;
};

function looksLikeCronString(value: string): boolean {
  const tokens = value.trim().split(/\s+/);
  if (tokens.length !== 5 && tokens.length !== 6) return false;
  return tokens.every((t) => CRON_TOKEN.test(t));
}

function validateCronExpression(expression: string, timezone: string): void {
  try {
    CronExpressionParser.parse(expression, { tz: timezone });
  } catch (e) {
    throw new WorkflowEngineError(
      `Invalid cron expression "${expression}" (timezone: ${timezone}): ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function durationMsToCron(ms: number, original: Duration): string {
  if (ms < MS_PER_MINUTE) {
    throw new WorkflowEngineError(
      `Schedule interval must be at least 1 minute; got ${ms}ms from ${JSON.stringify(original)}`,
    );
  }

  if (ms % MS_PER_DAY === 0) {
    const days = ms / MS_PER_DAY;
    if (days === 1) return '0 0 * * *';
    throw cronStepError(original, `${days} days`);
  }

  if (ms % MS_PER_HOUR === 0) {
    const hours = ms / MS_PER_HOUR;
    if (24 % hours === 0) return `0 */${hours} * * *`;
    throw cronStepError(original, `${hours} hours`);
  }

  const minutes = ms / MS_PER_MINUTE;
  if (Number.isInteger(minutes) && 60 % minutes === 0) return `*/${minutes} * * * *`;
  throw cronStepError(original, `${minutes} minutes`);
}

function cronStepError(original: Duration, label: string): WorkflowEngineError {
  return new WorkflowEngineError(
    `Schedule interval ${JSON.stringify(original)} (${label}) doesn't map cleanly to a recurring cron expression. Use a value that divides 60 minutes, 24 hours, or 1 day — or pass an explicit cron string.`,
  );
}

/**
 * Resolve a `schedule` option (cron string OR duration) to a cron expression
 * plus timezone. Throws with a helpful message on bad input.
 */
export function resolveSchedule(schedule: Schedule, timezone?: string): ResolvedSchedule {
  const tz = timezone ?? 'UTC';

  if (typeof schedule === 'string' && looksLikeCronString(schedule)) {
    validateCronExpression(schedule, tz);
    return { cron: schedule, timezone: tz };
  }

  // Duration string, DurationObject, or string that didn't match cron-charset.
  // `parseDuration` throws for empty strings and unparseable input; `durationMsToCron`
  // only ever emits cron expressions we construct ourselves, so no further validation needed.
  const ms = parseDuration(schedule);
  return { cron: durationMsToCron(ms, schedule), timezone: tz };
}
