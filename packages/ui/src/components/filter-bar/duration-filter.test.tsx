import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DurationFilter } from './duration-filter';

describe('DurationFilter', () => {
  it('shows Any duration by default', () => {
    render(<DurationFilter onChange={() => {}} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Any duration');
  });

  it('shows the selected preset label', () => {
    render(<DurationFilter value="lt-10s" onChange={() => {}} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Under 10s');
  });

  it('calls onChange with the chosen preset', async () => {
    const onChange = vi.fn();
    render(<DurationFilter onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: 'Over 5m' }));
    expect(onChange).toHaveBeenCalledWith('gt-5m');
  });

  it('clears the preset when Any duration is chosen', async () => {
    const onChange = vi.fn();
    render(<DurationFilter value="gt-1m" onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: 'Any duration' }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
