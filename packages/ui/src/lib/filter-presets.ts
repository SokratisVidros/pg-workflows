export const DATE_PRESETS = [
  { value: 'all', label: 'All time' },
  { value: '1h', label: 'Last hour' },
  { value: '24h', label: 'Last 24h' },
  { value: '7d', label: 'Last 7d' },
  { value: '30d', label: 'Last 30d' },
  { value: '90d', label: 'Last 90d' },
] as const;

export type DatePreset = (typeof DATE_PRESETS)[number]['value'];

export const DURATION_PRESETS = [
  { value: 'any', label: 'Any duration' },
  { value: 'lt-10s', label: 'Under 10s' },
  { value: 'lt-30s', label: 'Under 30s' },
  { value: 'lt-1m', label: 'Under 1m' },
  { value: 'gt-30s', label: 'Over 30s' },
  { value: 'gt-1m', label: 'Over 1m' },
  { value: 'gt-5m', label: 'Over 5m' },
  { value: 'gt-10m', label: 'Over 10m' },
] as const;

export type DurationPreset = (typeof DURATION_PRESETS)[number]['value'];

const DATE_OFFSET_MS: Record<Exclude<DatePreset, 'all'>, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

const DURATION_BOUNDS: Record<
  Exclude<DurationPreset, 'any'>,
  { minDurationMs?: number; maxDurationMs?: number }
> = {
  'lt-10s': { maxDurationMs: 10_000 },
  'lt-30s': { maxDurationMs: 30_000 },
  'lt-1m': { maxDurationMs: 60_000 },
  'gt-30s': { minDurationMs: 30_000 },
  'gt-1m': { minDurationMs: 60_000 },
  'gt-5m': { minDurationMs: 300_000 },
  'gt-10m': { minDurationMs: 600_000 },
};

export function datePresetToFrom(preset?: DatePreset, now = Date.now()): string | undefined {
  if (!preset || preset === 'all') return undefined;
  return new Date(now - DATE_OFFSET_MS[preset]).toISOString();
}

export function durationPresetToBounds(preset?: DurationPreset): {
  minDurationMs?: number;
  maxDurationMs?: number;
} {
  if (!preset || preset === 'any') return {};
  return DURATION_BOUNDS[preset];
}
