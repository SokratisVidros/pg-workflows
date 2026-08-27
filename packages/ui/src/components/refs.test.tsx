import { render } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import type { WorkflowRun } from '../client';
import {
  DateRangeFilter,
  DurationFilter,
  FilterBar,
  JsonViewer,
  LiveToggle,
  RunDetailHeader,
  SearchFilter,
  StatusBadge,
  StatusFilter,
  StepTimeline,
  WorkflowIdFilter,
} from './index';

const run = {
  id: 'run_a',
  workflowId: 'demo',
  status: 'completed',
  createdAt: '2026-06-17T12:00:00Z',
  completedAt: '2026-06-17T12:00:10Z',
  pausedAt: null,
  resourceId: null,
  currentStepId: '',
  input: {},
  timeline: {},
} as unknown as WorkflowRun;

describe('ref forwarding', () => {
  it('forwards a ref to StatusBadge’s root span', () => {
    const ref = createRef<HTMLSpanElement>();
    render(<StatusBadge ref={ref} status="completed" />);
    expect(ref.current).toBeInstanceOf(HTMLSpanElement);
  });

  it('forwards a ref to LiveToggle’s button', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<LiveToggle ref={ref} isLive isFetching={false} onToggle={() => {}} />);
    expect(ref.current?.tagName).toBe('BUTTON');
  });

  it('forwards a ref to JsonViewer in both the data and no-data branches', () => {
    const withData = createRef<HTMLDivElement>();
    render(<JsonViewer ref={withData} value={{ a: 1 }} />);
    expect(withData.current).toBeInstanceOf(HTMLDivElement);

    const noData = createRef<HTMLDivElement>();
    render(<JsonViewer ref={noData} value={undefined} />);
    expect(noData.current?.textContent).toBe('No data');
  });

  it('forwards a ref to RunDetailHeader’s header element', () => {
    const ref = createRef<HTMLElement>();
    render(<RunDetailHeader ref={ref} run={run} />);
    expect(ref.current?.tagName).toBe('HEADER');
  });

  it('forwards a ref to StepTimeline’s root', () => {
    const ref = createRef<HTMLDivElement>();
    render(<StepTimeline ref={ref} run={run} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('forwards a ref to FilterBar’s root and applies className', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <FilterBar
        ref={ref}
        className="custom-cls"
        filters={{ limit: 20, sort: 'createdAt', dir: 'desc' }}
        hasActiveFilters={false}
        workflowIds={[]}
        onFiltersChange={() => {}}
        onClear={() => {}}
      />,
    );
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current?.className).toContain('custom-cls');
  });

  it('forwards a ref to StatusFilter’s trigger', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<StatusFilter ref={ref} value={[]} onChange={() => {}} />);
    expect(ref.current?.tagName).toBe('BUTTON');
  });

  it('forwards a ref to DateRangeFilter’s trigger', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<DateRangeFilter ref={ref} onChange={() => {}} />);
    expect(ref.current?.tagName).toBe('BUTTON');
  });

  it('forwards a ref to DurationFilter’s trigger', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<DurationFilter ref={ref} onChange={() => {}} />);
    expect(ref.current?.tagName).toBe('BUTTON');
  });

  it('forwards a ref to SearchFilter’s root', () => {
    const ref = createRef<HTMLDivElement>();
    render(<SearchFilter ref={ref} onChange={() => {}} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('forwards a ref to WorkflowIdFilter’s trigger', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<WorkflowIdFilter ref={ref} options={['demo']} onChange={() => {}} />);
    expect(ref.current?.tagName).toBe('BUTTON');
  });
});
