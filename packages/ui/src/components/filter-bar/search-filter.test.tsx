import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchFilter } from './search-filter';

describe('SearchFilter', () => {
  it('renders as a pill-shaped field', () => {
    const { container } = render(<SearchFilter onChange={() => {}} />);
    expect(container.firstChild).toHaveClass('pgw-pill-outline', 'pgw-search');
    expect(screen.getByRole('textbox', { name: /search runs/i })).toBeInTheDocument();
  });

  it('calls onChange with the typed value', async () => {
    const onChange = vi.fn();
    render(<SearchFilter onChange={onChange} />);
    await userEvent.type(screen.getByRole('textbox', { name: /search runs/i }), 'a');
    expect(onChange).toHaveBeenLastCalledWith('a');
  });
});
