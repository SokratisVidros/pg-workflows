import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatusSummary } from './status-summary';

describe('StatusSummary', () => {
  it('renders a counter per present status with the correct count', () => {
    render(<StatusSummary counts={{ running: 2, completed: 4, failed: 1 }} />);
    expect(screen.getByText(/4/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2\s*running/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /4\s*completed/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1\s*failed/i })).toBeInTheDocument();
  });

  it('renders the label and count inside each counter', () => {
    render(<StatusSummary counts={{ running: 1, failed: 1 }} />);
    const runningCounter = screen.getByRole('button', { name: /running/i });
    expect(runningCounter).toHaveTextContent('1');
    expect(runningCounter).toHaveTextContent('running');
  });

  it('renders no counter for a status with zero runs', () => {
    render(<StatusSummary counts={{ running: 1 }} />);
    expect(screen.queryByRole('button', { name: /paused/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /completed/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /failed/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancelled/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /pending/i })).not.toBeInTheDocument();
  });

  it('calls onSelectStatus with the clicked status', () => {
    const onSelectStatus = vi.fn();
    render(<StatusSummary counts={{ running: 1, failed: 1 }} onSelectStatus={onSelectStatus} />);
    fireEvent.click(screen.getByRole('button', { name: /running/i }));
    expect(onSelectStatus).toHaveBeenCalledWith('running');
    fireEvent.click(screen.getByRole('button', { name: /failed/i }));
    expect(onSelectStatus).toHaveBeenCalledWith('failed');
  });

  it('renders nothing when there are no runs', () => {
    const { container } = render(<StatusSummary counts={{}} />);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('uses themeable tokens, not hardcoded palette colors', () => {
    const { container } = render(<StatusSummary counts={{ running: 1, failed: 1 }} />);
    expect(container.innerHTML).not.toMatch(
      /\b(?:text|bg|border|hover:bg)-(?:gray|red|blue|green|yellow|zinc|slate|neutral)-/,
    );
  });

  it('keeps counters monochrome', () => {
    render(<StatusSummary counts={{ running: 1 }} />);
    const counter = screen.getByRole('button', { name: /running/i });
    expect(counter.innerHTML).not.toMatch(/pgw-status-/);
    expect(counter.className).toMatch(/text-left/);
  });

  it('lays out every counter in a single row', () => {
    const { container } = render(
      <StatusSummary counts={{ running: 1, failed: 1, completed: 1 }} />,
    );
    expect(container.firstChild).toHaveClass('flex-row');
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });
});
