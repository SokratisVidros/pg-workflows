import type { WorkflowRun } from '../client';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function runAsOfMs(run: WorkflowRun): number {
  if (isTerminalStatus(run.status)) {
    return new Date(run.completedAt ?? run.updatedAt).getTime();
  }
  if (run.status === 'paused' && run.pausedAt) {
    return new Date(run.pausedAt).getTime();
  }
  return Date.now();
}

export function computeDurationMs(run: WorkflowRun): number | null {
  if (run.status === 'pending') return null;
  const start = new Date(run.createdAt).getTime();
  return runAsOfMs(run) - start;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function timeAgo(date: Date | string): string {
  const now = Date.now();
  const then = typeof date === 'string' ? new Date(date).getTime() : date.getTime();
  const diffMs = now - then;
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
