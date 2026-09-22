import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DateRangeFilter } from '../components/filter-bar/date-range-filter';
import { SearchFilter } from '../components/filter-bar/search-filter';
import { LiveToggle } from '../components/live-toggle';
import { StatusBadge } from '../components/status-badge';

describe('Base UI style hooks', () => {
  it('applies a className function and exposes status as a data attribute', () => {
    render(
      <StatusBadge
        status="failed"
        className={(state) => (state.status === 'failed' ? 'is-failed' : undefined)}
        style={(state) => ({ opacity: state.status === 'failed' ? 0.5 : 1 })}
      />,
    );

    const badge = screen.getByText('failed');
    expect(badge).toHaveClass('pgw-badge', 'is-failed');
    expect(badge).toHaveAttribute('data-status', 'failed');
    expect(badge).toHaveStyle({ opacity: '0.5' });
  });

  it('replaces the root element with render', () => {
    render(<StatusBadge status="completed" render={<a href="#run">completed</a>} />);
    expect(screen.getByRole('link')).toHaveClass('pgw-badge');
    expect(screen.getByRole('link')).toHaveAttribute('href', '#run');
  });

  it('passes toggle state into className', () => {
    const className = vi.fn().mockReturnValue('is-on');
    render(<LiveToggle isLive isFetching={false} onToggle={() => {}} className={className} />);

    expect(className).toHaveBeenCalledWith(
      expect.objectContaining({ pressed: true, disabled: false }),
    );
    expect(screen.getByRole('button')).toHaveClass('pgw-button', 'pgw-live', 'is-on');
  });

  it('passes select state into the trigger className and styles the input part', () => {
    const className = vi.fn().mockReturnValue('open-soon');
    render(
      <>
        <DateRangeFilter onChange={() => {}} className={className} />
        <SearchFilter
          value="invoice"
          onChange={() => {}}
          input={{ className: (state) => (state.disabled ? undefined : 'can-type') }}
        />
      </>,
    );

    expect(className).toHaveBeenCalledWith(expect.objectContaining({ open: false }));
    expect(screen.getByRole('combobox')).toHaveClass('pgw-select', 'open-soon');
    expect(screen.getByRole('textbox')).toHaveClass('pgw-input', 'can-type');
    expect(screen.getByRole('textbox').closest('label')).toHaveAttribute('data-filled', '');
  });
});
