import { describe, expect, it, vi } from 'vitest';
import { instrumentHtml } from './instrument';
import { createEmailPlugin } from './plugin';
import { createToken } from './token';

describe('createToken', () => {
  it('generates a base64url.hmac token', () => {
    const token = createToken('run-123', 'wait-open', 'secret');
    const [encoded, hmac] = token.split('.');
    expect(Buffer.from(encoded, 'base64url').toString()).toBe('run-123:wait-open');
    expect(hmac).toMatch(/^[0-9a-f]{12}$/);
  });

  it('produces the same token for the same inputs', () => {
    const t1 = createToken('run-123', 'step-1', 'my-secret');
    const t2 = createToken('run-123', 'step-1', 'my-secret');
    expect(t1).toBe(t2);
  });

  it('produces different tokens for different run IDs', () => {
    const t1 = createToken('run-1', 'step', 'secret');
    const t2 = createToken('run-2', 'step', 'secret');
    expect(t1).not.toBe(t2);
  });
});

describe('instrumentHtml', () => {
  const config = {
    openToken: 'open-token-abc',
    clickToken: 'click-token-xyz',
    trackerUrl: 'https://pgpass.ai',
  };

  it('appends tracking pixel inside <body>', () => {
    const html = '<html><body><p>Hello</p></body></html>';
    const result = instrumentHtml(html, config);
    expect(result).toContain('<img src="https://pgpass.ai/t/open-token-abc"');
    expect(result.indexOf('<img')).toBeLessThan(result.indexOf('</body>'));
  });

  it('rewrites the first <a href> to a redirect URL', () => {
    const html = '<html><body><a href="https://example.com/cta">Click me</a></body></html>';
    const result = instrumentHtml(html, config);
    expect(result).toContain(
      `https://pgpass.ai/r/click-token-xyz?url=${encodeURIComponent('https://example.com/cta')}`,
    );
  });

  it('does not rewrite links beyond the first', () => {
    const html =
      '<html><body><a href="https://first.com">First</a><a href="https://second.com">Second</a></body></html>';
    const result = instrumentHtml(html, config);
    expect(result).toContain('https://second.com');
    expect(result).not.toContain(
      `https://pgpass.ai/r/click-token-xyz?url=${encodeURIComponent('https://second.com')}`,
    );
  });

  it('strips trailing slash from trackerUrl', () => {
    const result = instrumentHtml('<html><body></body></html>', {
      ...config,
      trackerUrl: 'https://pgpass.ai/',
    });
    expect(result).not.toContain('//t/');
  });
});

// ---------------------------------------------------------------------------
// Shared mock factory
// ---------------------------------------------------------------------------

function makeMockStep(
  overrides: Partial<{
    poll: (...args: unknown[]) => Promise<unknown>;
  }> = {},
) {
  return {
    runId: 'run-abc',
    resourceId: undefined as string | undefined,
    run: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()),
    waitFor: vi.fn(),
    waitUntil: vi.fn(),
    delay: vi.fn(),
    sleep: vi.fn(),
    pause: vi.fn(),
    poll: vi.fn(),
    ...overrides,
  };
}

const baseConfig = {
  trackerUrl: 'https://pgpass.ai',
  secret: 'test-secret',
  apiKey: 'sk_test',
  send: vi.fn(),
};

// ---------------------------------------------------------------------------
// sendEmail
// ---------------------------------------------------------------------------

describe('createEmailPlugin — sendEmail', () => {
  it('wraps execution in step.run', async () => {
    const step = makeMockStep();
    const { sendEmail } = createEmailPlugin(baseConfig).methods(step as never);

    await sendEmail('send-welcome', {
      to: 'user@example.com',
      subject: 'Hello',
      html: '<body><a href="https://example.com">CTA</a></body>',
      openStepId: 'wait-open',
      clickStepId: 'wait-click',
    });

    expect(step.run).toHaveBeenCalledWith('send-welcome', expect.any(Function));
  });

  it('passes instrumented html with tracking pixel and redirect to config.send', async () => {
    const send = vi.fn();
    const step = makeMockStep();
    const { sendEmail } = createEmailPlugin({ ...baseConfig, send }).methods(step as never);

    await sendEmail('send-welcome', {
      to: 'user@example.com',
      subject: 'Test',
      html: '<body><a href="https://example.com/cta">CTA</a></body>',
      openStepId: 'wait-open',
      clickStepId: 'wait-click',
    });

    expect(send).toHaveBeenCalledOnce();
    const { html } = send.mock.calls[0][0] as { html: string };
    expect(html).toContain('https://pgpass.ai/t/');
    expect(html).toContain('https://pgpass.ai/r/');
    expect(html).toContain(encodeURIComponent('https://example.com/cta'));
  });
});

// ---------------------------------------------------------------------------
// waitForOpen
// ---------------------------------------------------------------------------

describe('createEmailPlugin — waitForOpen', () => {
  it('returns done:true with mapped data when tracker responds', async () => {
    const mockRecord = {
      event: 'open' as const,
      fired_at: '2026-03-04T00:00:00Z',
      ip: '1.2.3.4',
      user_agent: 'Mozilla/5.0',
    };
    const step = makeMockStep({
      poll: vi.fn().mockResolvedValue({ timedOut: false, data: mockRecord }),
    });
    const { waitForOpen } = createEmailPlugin(baseConfig).methods(step as never);

    const result = await waitForOpen('wait-open', '3 days');

    expect(result).toMatchObject({
      done: true,
      data: { openedAt: '2026-03-04T00:00:00Z', ipAddress: '1.2.3.4' },
    });
    expect(step.poll).toHaveBeenCalledWith('wait-open', expect.any(Function), {
      timeout: '3 days',
    });
  });

  it('returns done:false with timeout state when timedOut', async () => {
    const step = makeMockStep({
      poll: vi.fn().mockResolvedValue({ timedOut: true }),
    });
    const { waitForOpen } = createEmailPlugin(baseConfig).methods(step as never);

    const result = await waitForOpen('wait-open', { days: 3 });

    expect(result).toEqual({ done: false, state: 'timeout', duration: { days: 3 } });
  });

  it('polling function calls tracker API with signed token', async () => {
    let capturedCondition: (() => Promise<unknown>) | undefined;

    const step = makeMockStep({
      poll: vi.fn().mockImplementation(async (_id: string, condition: () => Promise<unknown>) => {
        capturedCondition = condition;
        return { timedOut: true };
      }),
    });
    const { waitForOpen } = createEmailPlugin(baseConfig).methods(step as never);
    await waitForOpen('wait-open', '3 days');

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ json: async () => ({ found: false }) } as Response);

    const conditionResult = await capturedCondition!();

    expect(conditionResult).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/events\//),
      expect.objectContaining({ headers: { Authorization: 'Bearer sk_test' } }),
    );
    fetchMock.mockRestore();
  });

  it('polling function returns tracker data when event is found', async () => {
    const trackerData = { event: 'open', fired_at: '2026-03-04T00:00:00Z' };
    let capturedCondition: (() => Promise<unknown>) | undefined;

    const step = makeMockStep({
      poll: vi.fn().mockImplementation(async (_id: string, condition: () => Promise<unknown>) => {
        capturedCondition = condition;
        return { timedOut: true };
      }),
    });
    const { waitForOpen } = createEmailPlugin(baseConfig).methods(step as never);
    await waitForOpen('wait-open', '3 days');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      json: async () => ({ found: true, data: trackerData }),
    } as Response);

    const conditionResult = await capturedCondition!();
    expect(conditionResult).toEqual(trackerData);
    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// waitForClick
// ---------------------------------------------------------------------------

describe('createEmailPlugin — waitForClick', () => {
  it('returns done:true with url in data', async () => {
    const mockRecord = {
      event: 'click' as const,
      url: 'https://example.com/cta',
      fired_at: '2026-03-04T00:00:00Z',
    };
    const step = makeMockStep({
      poll: vi.fn().mockResolvedValue({ timedOut: false, data: mockRecord }),
    });
    const { waitForClick } = createEmailPlugin(baseConfig).methods(step as never);

    const result = await waitForClick('wait-click', '1 day');

    expect(result).toMatchObject({
      done: true,
      data: { clickedAt: '2026-03-04T00:00:00Z', url: 'https://example.com/cta' },
    });
  });

  it('returns done:false with timeout state', async () => {
    const step = makeMockStep({
      poll: vi.fn().mockResolvedValue({ timedOut: true }),
    });
    const { waitForClick } = createEmailPlugin(baseConfig).methods(step as never);

    const result = await waitForClick('wait-click', '1 day');

    expect(result).toEqual({ done: false, state: 'timeout', duration: '1 day' });
  });
});
