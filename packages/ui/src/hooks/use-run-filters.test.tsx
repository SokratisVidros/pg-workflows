import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useRunFilters } from './use-run-filters';

describe('useRunFilters', () => {
  it('exposes defaults and setters', () => {
    const { result } = renderHook(() => useRunFilters());
    expect(result.current.filters.limit).toBe(20);
    expect(result.current.filters.sort).toBe('createdAt');
    expect(result.current.filters.dir).toBe('desc');
    expect(result.current.hasActiveFilters).toBe(false);
  });

  it('toggleSort flips direction on same key, defaults to desc on new key', () => {
    const { result } = renderHook(() => useRunFilters());
    act(() => result.current.toggleSort('createdAt'));
    expect(result.current.filters.dir).toBe('asc');
    act(() => result.current.toggleSort('createdAt'));
    expect(result.current.filters.dir).toBe('desc');
    act(() => result.current.toggleSort('id'));
    expect(result.current.filters.sort).toBe('id');
    expect(result.current.filters.dir).toBe('desc');
  });

  it('clearFilters resets to defaults', () => {
    const { result } = renderHook(() => useRunFilters());
    act(() => result.current.setFilters({ workflowId: 'kb-crawl', search: 'abc' }));
    expect(result.current.hasActiveFilters).toBe(true);
    act(() => result.current.clearFilters());
    expect(result.current.hasActiveFilters).toBe(false);
  });
});
