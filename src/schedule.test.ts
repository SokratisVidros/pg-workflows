import { describe, expect, it } from 'vitest';
import { WorkflowEngineError } from './error';
import { resolveSchedule } from './schedule';

describe('resolveSchedule', () => {
  describe('cron strings', () => {
    it('passes through a standard 5-field cron expression', () => {
      expect(resolveSchedule('*/5 * * * *')).toEqual({
        cron: '*/5 * * * *',
        timezone: 'UTC',
      });
    });

    it('passes through a 6-field cron expression (with seconds)', () => {
      expect(resolveSchedule('0 0 12 * * *')).toEqual({
        cron: '0 0 12 * * *',
        timezone: 'UTC',
      });
    });

    it('uses provided timezone for cron expressions', () => {
      expect(resolveSchedule('0 9 * * 1-5', 'America/New_York')).toEqual({
        cron: '0 9 * * 1-5',
        timezone: 'America/New_York',
      });
    });

    it('throws on an invalid cron expression', () => {
      expect(() => resolveSchedule('* * * *')).toThrow();
      expect(() => resolveSchedule('99 * * * *')).toThrow(WorkflowEngineError);
    });
  });

  describe('duration strings', () => {
    it('translates a duration that divides 60 minutes cleanly', () => {
      expect(resolveSchedule('5m')).toEqual({ cron: '*/5 * * * *', timezone: 'UTC' });
      expect(resolveSchedule('15m')).toEqual({ cron: '*/15 * * * *', timezone: 'UTC' });
      expect(resolveSchedule('30m')).toEqual({ cron: '*/30 * * * *', timezone: 'UTC' });
    });

    it('translates a duration that divides 24 hours cleanly', () => {
      expect(resolveSchedule('1h')).toEqual({ cron: '0 */1 * * *', timezone: 'UTC' });
      expect(resolveSchedule('2 hours')).toEqual({ cron: '0 */2 * * *', timezone: 'UTC' });
      expect(resolveSchedule('12h')).toEqual({ cron: '0 */12 * * *', timezone: 'UTC' });
    });

    it('translates 1 day to midnight cron', () => {
      expect(resolveSchedule('1d')).toEqual({ cron: '0 0 * * *', timezone: 'UTC' });
      expect(resolveSchedule('1 day')).toEqual({ cron: '0 0 * * *', timezone: 'UTC' });
    });

    it('throws on durations under a minute', () => {
      expect(() => resolveSchedule('30s')).toThrow(/at least 1 minute/);
    });

    it('throws on durations that do not divide cleanly', () => {
      expect(() => resolveSchedule('23m')).toThrow(/doesn't map cleanly/);
      expect(() => resolveSchedule('7h')).toThrow(/doesn't map cleanly/);
      expect(() => resolveSchedule('2d')).toThrow(/doesn't map/);
    });

    it('throws on empty string', () => {
      expect(() => resolveSchedule('')).toThrow(/empty/);
    });
  });

  describe('duration objects', () => {
    it('translates { minutes: N } where N divides 60', () => {
      expect(resolveSchedule({ minutes: 5 })).toEqual({
        cron: '*/5 * * * *',
        timezone: 'UTC',
      });
    });

    it('translates { hours: N } where N divides 24', () => {
      expect(resolveSchedule({ hours: 6 })).toEqual({
        cron: '0 */6 * * *',
        timezone: 'UTC',
      });
    });

    it('translates { days: 1 } to midnight cron', () => {
      expect(resolveSchedule({ days: 1 })).toEqual({
        cron: '0 0 * * *',
        timezone: 'UTC',
      });
    });

    it('throws on { minutes: 23 } (does not divide 60)', () => {
      expect(() => resolveSchedule({ minutes: 23 })).toThrow(/doesn't map cleanly/);
    });
  });
});
