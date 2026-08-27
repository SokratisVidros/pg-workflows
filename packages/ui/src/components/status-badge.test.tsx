import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from './status-badge';

describe('StatusBadge', () => {
  it.each([
    ['completed', /completed/i],
    ['failed', /failed/i],
    ['running', /running/i],
    ['paused', /paused/i],
    ['cancelled', /cancelled/i],
    ['pending', /pending/i],
  ])('renders %s', (status, pattern) => {
    render(<StatusBadge status={status as never} />);
    expect(screen.getByText(pattern)).toBeInTheDocument();
  });

  it('applies the matching status token class', () => {
    render(<StatusBadge status="failed" />);
    const el = screen.getByText(/failed/i);
    expect(el.className).toMatch(/pgw-status-failed/);
  });

  it('applies the full literal text class so Tailwind can statically discover it', () => {
    render(<StatusBadge status="running" />);
    const el = screen.getByText(/running/i);
    expect(el.className).toContain('text-pgw-status-running');
  });
});
