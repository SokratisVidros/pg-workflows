import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { RunFilters } from '../../hooks/use-run-filters';
import { FilterBar } from './filter-bar';

const baseFilters: RunFilters = { limit: 20, sort: 'createdAt', dir: 'desc' };

describe('FilterBar', () => {
  it('keeps Clear in the filter row', () => {
    render(
      <FilterBar
        filters={{ ...baseFilters, workflowId: 'demo' }}
        hasActiveFilters
        workflowIds={['demo']}
        onFiltersChange={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    const clear = screen.getByRole('button', { name: /clear/i });
    expect(clear.parentElement).toHaveClass('pgw-filter-pills-row');
  });

  it('reserves Clear when inactive so showing it does not change layout', () => {
    const { container } = render(
      <FilterBar
        filters={baseFilters}
        hasActiveFilters={false}
        workflowIds={[]}
        onFiltersChange={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    const clear = container.querySelector('.pgw-clear');
    expect(clear).toHaveAttribute('data-inactive');
    expect(clear?.parentElement).toHaveClass('pgw-filter-pills-row');
    expect(screen.queryByRole('button', { name: /clear/i })).toBeNull();
  });

  it('calls onClear when Clear is clicked', async () => {
    const onClear = vi.fn();
    render(
      <FilterBar
        filters={{ ...baseFilters, search: 'abc' }}
        hasActiveFilters
        workflowIds={[]}
        onFiltersChange={vi.fn()}
        onClear={onClear}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});
