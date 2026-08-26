import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LiveIndicator } from './live-indicator';

describe('LiveIndicator', () => {
  it('shows Live when isLive=true', () => {
    render(<LiveIndicator isLive isFetching={false} onToggle={() => {}} />);
    expect(screen.getByRole('button')).toHaveTextContent(/live/i);
  });

  it('shows Paused when isLive=false', () => {
    render(<LiveIndicator isLive={false} isFetching={false} onToggle={() => {}} />);
    expect(screen.getByRole('button')).toHaveTextContent(/paused/i);
  });

  it('calls onToggle when clicked', async () => {
    const onToggle = vi.fn();
    render(<LiveIndicator isLive isFetching={false} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
