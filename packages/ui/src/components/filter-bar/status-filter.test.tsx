import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StatusFilter } from './status-filter';

describe('StatusFilter', () => {
  it('opens, toggles a value, and calls onChange', async () => {
    const onChange = vi.fn();
    render(<StatusFilter value={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /status/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /running/i }));
    expect(onChange).toHaveBeenCalledWith(['running']);
  });

  it('shows count when values are selected', () => {
    render(<StatusFilter value={['running', 'failed']} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /status \(2\)/i })).toBeInTheDocument();
  });

  it('uses a text button trigger', () => {
    render(<StatusFilter value={[]} onChange={() => {}} />);
    const button = screen.getByRole('button', { name: /status/i });
    expect(button).toHaveClass('pgw-button');
    expect(button).not.toHaveAttribute('data-active');
  });

  it('marks the trigger active when values are selected', () => {
    render(<StatusFilter value={['running']} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /status/i })).toHaveAttribute('data-active', 'true');
  });
});
