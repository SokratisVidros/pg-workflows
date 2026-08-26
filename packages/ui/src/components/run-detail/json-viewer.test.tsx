import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { JsonViewer } from './json-viewer';

describe('JsonViewer', () => {
  it('pretty-prints JSON', () => {
    render(<JsonViewer value={{ a: 1, b: 'x' }} />);
    expect(screen.getByText(/"a": 1/)).toBeInTheDocument();
  });

  it('renders "null" for null', () => {
    render(<JsonViewer value={null} />);
    expect(screen.getByText('null')).toBeInTheDocument();
  });

  it('renders empty fallback when value is undefined', () => {
    render(<JsonViewer value={undefined} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });
});
