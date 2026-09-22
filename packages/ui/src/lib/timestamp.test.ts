import { describe, expect, it } from 'vitest';
import { formatLocalTimestamp, formatUtcTimestamp, toTimestamp } from './timestamp';

describe('toTimestamp', () => {
  it('accepts dates and ISO strings', () => {
    expect(toTimestamp(new Date('2024-03-15T12:34:56.000Z'))?.toISOString()).toBe(
      '2024-03-15T12:34:56.000Z',
    );
    expect(toTimestamp('2024-03-15T12:34:56.000Z')?.toISOString()).toBe('2024-03-15T12:34:56.000Z');
  });

  it('rejects empty and invalid values', () => {
    expect(toTimestamp(null)).toBeNull();
    expect(toTimestamp('')).toBeNull();
    expect(toTimestamp('not-a-date')).toBeNull();
  });
});

describe('formatUtcTimestamp', () => {
  it('formats an absolute UTC timestamp', () => {
    expect(formatUtcTimestamp(new Date('2024-03-15T12:34:56.000Z'))).toBe(
      '2024-03-15 12:34:56 UTC',
    );
  });
});

describe('formatLocalTimestamp', () => {
  it('includes the clock time in the local zone', () => {
    const date = new Date('2024-03-15T12:34:56.000Z');
    const formatted = formatLocalTimestamp(date);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    expect(formatted).toContain(`${hours}:${minutes}`);
    expect(formatted).toContain('2024');
  });
});
