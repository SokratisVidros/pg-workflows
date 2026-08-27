import { describe, expect, it } from 'vitest';
import * as server from './index';

describe('server barrel', () => {
  it('exports the public server surface', () => {
    expect(typeof server.createWorkflowRunsApi).toBe('function');
    expect(typeof server.toNodeHandler).toBe('function');
    expect(typeof server.toErrorResponse).toBe('function');
    expect(typeof server.HttpError).toBe('function');
  });
});
