import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DateRangeFilter } from './date-range-filter';

describe('DateRangeFilter', () => {
  it('shows All time by default', () => {
    render(<DateRangeFilter onChange={() => {}} />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('All time');
    expect(trigger).toHaveClass('pgw-select');
    expect(trigger).not.toHaveAttribute('data-active');
  });

  it('shows the selected preset label', () => {
    render(<DateRangeFilter value="24h" onChange={() => {}} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Last 24h');
  });

  it('calls onChange with the chosen preset', async () => {
    const onChange = vi.fn();
    render(<DateRangeFilter onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: 'Last 7d' }));
    expect(onChange).toHaveBeenCalledWith('7d');
  });

  it('clears the preset when All time is chosen', async () => {
    const onChange = vi.fn();
    render(<DateRangeFilter value="24h" onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: 'All time' }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
