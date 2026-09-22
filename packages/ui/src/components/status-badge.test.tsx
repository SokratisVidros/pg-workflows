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

  it('uses square border chrome instead of status-tint classes', () => {
    render(<StatusBadge status="failed" />);
    const el = screen.getByText(/failed/i);
    expect(el.className).toMatch(/pgw-badge/);
    expect(el.className).not.toMatch(/pgw-status-failed/);
    expect(el.className).not.toMatch(/rounded-full|rounded-pgw-pill/);
  });
});
