import parse from 'parse-duration';
import { WorkflowEngineError } from './error';

export type DurationObject = {
  weeks?: number;
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
};

export type Duration = string | DurationObject;

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MS_PER_WEEK = 7 * MS_PER_DAY;

export function parseDuration(duration: Duration): number {
  if (typeof duration === 'string') {
    if (duration.trim() === '') {
      throw new WorkflowEngineError('Invalid duration: empty string');
    }

    const ms = parse(duration);

    if (ms == null || ms <= 0) {
      throw new WorkflowEngineError(`Invalid duration: "${duration}"`);
    }

    return ms;
  }

  const { weeks = 0, days = 0, hours = 0, minutes = 0, seconds = 0 } = duration;

  const ms =
    weeks * MS_PER_WEEK +
    days * MS_PER_DAY +
    hours * MS_PER_HOUR +
    minutes * MS_PER_MINUTE +
    seconds * MS_PER_SECOND;

  if (ms <= 0) {
    throw new WorkflowEngineError('Invalid duration: must be a positive value');
  }

  return ms;
}
