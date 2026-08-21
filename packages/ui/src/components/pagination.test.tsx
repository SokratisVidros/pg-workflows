import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Pagination } from './pagination';

describe('Pagination', () => {
  it('disables Prev when hasPrev is false and Next when hasNext is false', () => {
    render(<Pagination hasPrev={false} hasNext={false} onPrev={() => {}} onNext={() => {}} />);
    expect(screen.getByRole('button', { name: /prev/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('fires onPrev/onNext when enabled buttons are clicked', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<Pagination hasPrev hasNext onPrev={onPrev} onNext={onNext} />);
    fireEvent.click(screen.getByRole('button', { name: /prev/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(onPrev).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('uses themeable tokens, not hardcoded palette colors', () => {
    const { container } = render(
      <Pagination hasPrev hasNext onPrev={() => {}} onNext={() => {}} />,
    );
    expect(container.innerHTML).not.toMatch(
      /\b(?:text|bg|border|hover:bg)-(?:gray|red|blue|green|yellow|zinc|slate|neutral)-/,
    );
  });
});
