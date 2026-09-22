import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { timeAgo } from '../lib/duration';
import { formatLocalTimestamp, formatUtcTimestamp } from '../lib/timestamp';
import { Timestamp } from './timestamp';

describe('Timestamp', () => {
  it('shows a short relative time', () => {
    const value = new Date(Date.now() - 5 * 60_000).toISOString();
    render(<Timestamp value={value} />);
    expect(screen.getByText(timeAgo(value))).toBeInTheDocument();
  });

  it('shows local and UTC timestamps on two rows when hovered', async () => {
    const value = '2024-03-15T12:34:56.000Z';
    const user = userEvent.setup();
    render(<Timestamp value={value} />);
    await user.hover(screen.getByText(timeAgo(value)));
    const date = new Date(value);
    expect(await screen.findByText(formatLocalTimestamp(date))).toBeInTheDocument();
    expect(screen.getByText(formatUtcTimestamp(date))).toBeInTheDocument();
    expect(screen.getByText('Local')).toBeInTheDocument();
    expect(screen.getByText('UTC')).toBeInTheDocument();
  });

  it('renders an em dash when the value is missing', () => {
    render(<Timestamp value={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
