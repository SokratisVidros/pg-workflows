import { describe, expect, it } from 'vitest';
import { HttpError } from './errors';
import { parseFastForwardBody, parseListParams, parseTriggerBody, readJson } from './params';

const u = (qs: string) => new URL(`http://x/workflow-runs${qs}`);

describe('parseListParams', () => {
  it('maps snake_case query params to engine camelCase args', () => {
    const url = u(
      '?starting_after=a&ending_before=b&limit=25&workflow_id=k&statuses=running&statuses=paused',
    );
    expect(parseListParams(url)).toEqual({
      startingAfter: 'a',
      endingBefore: 'b',
      limit: 25,
      workflowId: 'k',
      statuses: ['running', 'paused'],
    });
  });

  it('returns an empty object when no params are present', () => {
    expect(parseListParams(u(''))).toEqual({});
  });

  it('throws HttpError 400 on an unknown status value', () => {
    try {
      parseListParams(u('?statuses=bogus'));
      throw new Error('did not throw');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(400);
    }
  });

  it('throws HttpError 400 on a non-positive limit', () => {
    expect(() => parseListParams(u('?limit=0'))).toThrow(HttpError);
  });
});

describe('parseTriggerBody', () => {
  it('accepts eventName with optional data', () => {
    expect(parseTriggerBody({ eventName: 'e', data: { a: 1 } })).toEqual({
      eventName: 'e',
      data: { a: 1 },
    });
  });
  it('throws HttpError 400 when eventName is missing', () => {
    expect(() => parseTriggerBody({ data: {} })).toThrow(HttpError);
  });
});

describe('parseFastForwardBody', () => {
  it('accepts an empty body', () => {
    expect(parseFastForwardBody({})).toEqual({});
  });
  it('accepts optional data', () => {
    expect(parseFastForwardBody({ data: { x: true } })).toEqual({ data: { x: true } });
  });
});

describe('readJson', () => {
  it('returns {} for an empty body', async () => {
    expect(await readJson(new Request('http://x', { method: 'POST' }))).toEqual({});
  });
  it('parses a JSON body', async () => {
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ a: 1 }) });
    expect(await readJson(req)).toEqual({ a: 1 });
  });
});
