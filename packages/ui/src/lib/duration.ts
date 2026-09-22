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
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function timeAgo(date: Date | string, now = Date.now()): string {
  const then = typeof date === 'string' ? new Date(date).getTime() : date.getTime();
  const diffMs = now - then;
  const diffSeconds = Math.floor(Math.abs(diffMs) / 1000);
  let amount: string;
  if (diffSeconds < 60) amount = `${diffSeconds}s`;
  else {
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) amount = `${diffMinutes}m`;
    else {
      const diffHours = Math.floor(diffMinutes / 60);
      if (diffHours < 24) amount = `${diffHours}h`;
      else amount = `${Math.floor(diffHours / 24)}d`;
    }
  }
  return diffMs < 0 ? `in ${amount}` : `${amount} ago`;
}
