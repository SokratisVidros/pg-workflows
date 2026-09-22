import { describe, expect, it } from 'vitest';
import {
  DATE_PRESETS,
  DURATION_PRESETS,
  datePresetToFrom,
  durationPresetToBounds,
} from './filter-presets';

describe('DATE_PRESETS', () => {
  it('lists the relative range options in display order', () => {
    expect(DATE_PRESETS.map((p) => p.label)).toEqual([
      'All time',
      'Last hour',
      'Last 24h',
      'Last 7d',
      'Last 30d',
      'Last 90d',
    ]);
  });
});

describe('DURATION_PRESETS', () => {
  it('lists the duration options in display order', () => {
    expect(DURATION_PRESETS.map((p) => p.label)).toEqual([
      'Any duration',
      'Under 10s',
      'Under 30s',
      'Under 1m',
      'Over 30s',
      'Over 1m',
      'Over 5m',
      'Over 10m',
    ]);
  });
});

describe('datePresetToFrom', () => {
  const now = Date.parse('2026-06-17T14:00:00Z');

  it('returns undefined for all-time / empty presets', () => {
    expect(datePresetToFrom(undefined, now)).toBeUndefined();
    expect(datePresetToFrom('all', now)).toBeUndefined();
  });

  it.each([
    ['1h', '2026-06-17T13:00:00.000Z'],
    ['24h', '2026-06-16T14:00:00.000Z'],
    ['7d', '2026-06-10T14:00:00.000Z'],
    ['30d', '2026-05-18T14:00:00.000Z'],
    ['90d', '2026-03-19T14:00:00.000Z'],
  ] as const)('maps %s to an ISO start time', (preset, expected) => {
    expect(datePresetToFrom(preset, now)).toBe(expected);
  });
});

describe('durationPresetToBounds', () => {
  it('returns empty bounds for any-duration / empty presets', () => {
    expect(durationPresetToBounds(undefined)).toEqual({});
    expect(durationPresetToBounds('any')).toEqual({});
  });

  it.each([
    ['lt-10s', { maxDurationMs: 10_000 }],
    ['lt-30s', { maxDurationMs: 30_000 }],
    ['lt-1m', { maxDurationMs: 60_000 }],
    ['gt-30s', { minDurationMs: 30_000 }],
    ['gt-1m', { minDurationMs: 60_000 }],
    ['gt-5m', { minDurationMs: 300_000 }],
    ['gt-10m', { minDurationMs: 600_000 }],
  ] as const)('maps %s to duration bounds', (preset, expected) => {
    expect(durationPresetToBounds(preset)).toEqual(expected);
  });
});
