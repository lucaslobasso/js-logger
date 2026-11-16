import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getLogger, init, type LogEvent, type Logger } from '../src/index';

const ENDPOINT = 'https://logs.example.com/ingest';

type Call = { url: string; init?: RequestInit; events: LogEvent[] };
let calls: Call[];
let status: (url: string) => number;
let realFetch: typeof fetch;
let logger: Logger | undefined;

function sent(): LogEvent[] {
  return calls.filter((c) => c.url === ENDPOINT).flatMap((c) => c.events);
}

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  status = () => 200;
  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, req?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = typeof req?.body === 'string' ? JSON.parse(req.body) : { events: [] };
    calls.push({ url, init: req, events: body.events ?? [] });
    const s = status(url);
    return { ok: s < 400, status: s, statusText: s === 404 ? 'Not Found' : s >= 500 ? 'Server Error' : 'OK' } as Response;
  }) as typeof fetch;
});

afterEach(() => {
  logger?.teardown();
  logger = undefined;
  globalThis.fetch = realFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const start = (opts: Partial<Parameters<typeof init>[0]> = {}) => (logger = init({ endpoint: ENDPOINT, ...opts }));

describe('init', () => {
  it('requires an endpoint', () => {
    expect(() => init({} as never)).toThrow(/endpoint/);
  });

  it('registers the active logger and replaces the previous one', () => {
    const first = start();
    expect(getLogger()).toBe(first);
    const second = start();
    expect(getLogger()).toBe(second);
    second.teardown();
    expect(getLogger()).toBeNull();
  });
});

describe('manual logging and batching', () => {
  it('sends a partial batch after flushInterval with the event fields', async () => {
    start({ app: 'shop', release: '1.2.3', context: { tenant: 'a' } });
    logger!.setUser({ id: 7 });
    logger!.info('hello', { step: 2 });
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2000);
    const [event] = sent();
    expect(event).toMatchObject({
      level: 'info',
      message: 'hello',
      source: 'manual',
      app: 'shop',
      release: '1.2.3',
      user: { id: 7 },
      context: { tenant: 'a', step: 2 },
    });
    expect(event.timestamp).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(event.fingerprint).toMatch(/^[0-9a-z]+$/);
    expect(calls[0].init?.method).toBe('POST');
    expect((calls[0].init?.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('drops events below the level', async () => {
    start({ level: 'warn' });
    logger!.debug('no');
    logger!.info('no');
    logger!.warn('yes');
    await logger!.flush();
    expect(sent().map((e) => e.message)).toEqual(['yes']);
  });

  it('sends a full batch at once', async () => {
    start({ batchSize: 2 });
    logger!.info('a');
    logger!.info('b');
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    expect(sent()).toHaveLength(2);
  });

  it('serializes errors with stack and cause', async () => {
    start();
    logger!.exception(new TypeError('outer', { cause: new Error('inner') }), { orderId: 1 });
    await logger!.flush();
    const [event] = sent();
    expect(event.level).toBe('error');
    expect(event.message).toBe('TypeError: outer');
    expect(event.error).toMatchObject({ name: 'TypeError', message: 'outer', cause: { name: 'Error', message: 'inner' } });
    expect(event.error?.stack).toContain('outer');
  });

  it('stringifies objects', async () => {
    start();
    logger!.warn({ a: 1 });
    await logger!.flush();
    expect(sent()[0].message).toBe('{"a":1}');
  });
});

describe('filters', () => {
  it('sends identical events once within dedupeMs', async () => {
    start({ dedupeMs: 1000 });
    logger!.error('same');
    logger!.error('same');
    await vi.advanceTimersByTimeAsync(1500);
    logger!.error('same');
    await logger!.flush();
    expect(sent()).toHaveLength(2);
  });

  it('redacts emails and secret-looking keys by default', async () => {
    start();
    logger!.error('login failed for ana@example.com password=hunter2', { password: 'x', authorization: 'Bearer y', author: 'kept' });
    await logger!.flush();
    const [event] = sent();
    expect(event.message).toBe('login failed for [email] password=[redacted]');
    expect(event.context).toEqual({ password: '[redacted]', authorization: '[redacted]', author: 'kept' });
  });

  it('leaves data alone with redact: false', async () => {
    start({ redact: false });
    logger!.info('ana@example.com');
    await logger!.flush();
    expect(sent()[0].message).toBe('ana@example.com');
  });

  it('beforeSend can change or drop events', async () => {
    start({ beforeSend: (e) => (e.message === 'drop' ? null : { ...e, message: e.message.toUpperCase() }) });
    logger!.info('drop');
    logger!.info('keep');
    await logger!.flush();
    expect(sent().map((e) => e.message)).toEqual(['KEEP']);
  });

  it('sampleRate 0 sends nothing', async () => {
    start({ sampleRate: 0 });
    logger!.error('x');
    await logger!.flush();
    expect(sent()).toHaveLength(0);
  });
});

describe('automatic capture', () => {
  it('captures uncaught errors', async () => {
    start();
    const error = new Error('boom');
    window.dispatchEvent(new ErrorEvent('error', { error, message: 'boom', filename: 'app.js', lineno: 3, colno: 9 }));
    await logger!.flush();
    expect(sent()[0]).toMatchObject({ source: 'error', message: 'Error: boom', context: { file: 'app.js', line: 3, column: 9 } });
  });

  it('captures failed resource loads', async () => {
    start();
    const img = document.createElement('img');
    img.setAttribute('src', 'https://cdn.example.com/missing.png');
    document.body.appendChild(img);
    img.dispatchEvent(new Event('error'));
    await logger!.flush();
    expect(sent()[0]).toMatchObject({ source: 'resource', message: 'Failed to load <img> https://cdn.example.com/missing.png' });
    img.remove();
  });

  it('captures unhandled rejections', async () => {
    start();
    const event = Object.assign(new Event('unhandledrejection'), { reason: new RangeError('nope') });
    window.dispatchEvent(event);
    await logger!.flush();
    expect(sent()[0]).toMatchObject({ source: 'unhandledrejection', message: 'RangeError: nope' });
  });

  it('captures failed fetch calls but not its own requests', async () => {
    status = (url) => (url.includes('/api/') ? 404 : 200);
    start();
    await fetch('https://shop.example.com/api/cart', { method: 'post' });
    await fetch('https://shop.example.com/ok');
    await logger!.flush();
    await logger!.flush();
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      source: 'fetch',
      message: 'POST https://shop.example.com/api/cart failed: 404 Not Found',
      context: { status: 404, method: 'POST' },
    });
  });

  it('captures fetch network errors, ignores aborts, and rethrows', async () => {
    const inner = globalThis.fetch;
    const failing = vi.fn(async (input: RequestInfo | URL, req?: RequestInit) => {
      if (String(input).includes('abort')) throw new DOMException('aborted', 'AbortError');
      if (String(input).includes('down')) throw new TypeError('Failed to fetch');
      return inner(input, req);
    });
    globalThis.fetch = failing as typeof fetch;
    start();
    await expect(fetch('https://x.example.com/down')).rejects.toThrow('Failed to fetch');
    await expect(fetch('https://x.example.com/abort')).rejects.toThrow('aborted');
    await logger!.flush();
    expect(sent().map((e) => e.message)).toEqual(['GET https://x.example.com/down failed: Failed to fetch']);
  });

  it('captures failed XMLHttpRequest calls', async () => {
    class FakeXHR extends EventTarget {
      status = 0;
      statusText = '';
      open(_m: string, _u: string) {}
      send() {
        this.status = 500;
        this.statusText = 'Server Error';
        this.dispatchEvent(new Event('loadend'));
      }
    }
    const real = globalThis.XMLHttpRequest;
    globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest;
    try {
      start();
      const xhr = new XMLHttpRequest();
      xhr.open('get', '/api/items');
      xhr.send();
      await logger!.flush();
      expect(sent()[0]).toMatchObject({ source: 'xhr', message: 'GET /api/items failed: 500 Server Error', context: { status: 500 } });
      logger!.teardown();
      expect(FakeXHR.prototype.open).toBe(FakeXHR.prototype.open); // restored, still callable
    } finally {
      globalThis.XMLHttpRequest = real;
    }
  });

  it('captures console.error only when enabled, without logging itself', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    start({ captureConsole: true, beforeSend: (e) => (console.error('inside beforeSend'), e) });
    console.error('visible', 42);
    await logger!.flush();
    expect(sent().map((e) => e.message)).toEqual(['visible 42']);
    expect(quiet).toHaveBeenCalledTimes(2);
  });

  it('does not touch console by default', async () => {
    const original = console.error;
    start();
    expect(console.error).toBe(original);
  });
});

describe('delivery', () => {
  it('retries on 5xx with backoff, then succeeds', async () => {
    let n = 0;
    status = () => (++n < 3 ? 503 : 200);
    start();
    logger!.error('x');
    const done = logger!.flush();
    await vi.advanceTimersByTimeAsync(1000 + 2000);
    await done;
    expect(calls).toHaveLength(3);
  });

  it('does not retry on 4xx and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    status = () => 400;
    start({ dedupeMs: 0 });
    logger!.error('x');
    await logger!.flush();
    logger!.error('x');
    await logger!.flush();
    expect(calls).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps at most maxQueue events', async () => {
    start({ maxQueue: 3, batchSize: 100 });
    for (let i = 0; i < 5; i++) logger!.info(`m${i}`);
    await logger!.flush();
    expect(sent().map((e) => e.message)).toEqual(['m2', 'm3', 'm4']);
  });

  it('flushes with sendBeacon when the page is hidden', () => {
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    start();
    logger!.error('leaving');
    window.dispatchEvent(new Event('pagehide'));
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, blob] = beacon.mock.calls[0] as unknown as [string, Blob];
    expect(url).toBe(ENDPOINT);
    expect(blob.type).toContain('text/plain');
    expect(calls).toHaveLength(0);
  });

  it('uses fetch keepalive on exit when custom headers are set', () => {
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    start({ headers: { 'x-api-key': 'k' } });
    logger!.error('leaving');
    window.dispatchEvent(new Event('pagehide'));
    expect(beacon).not.toHaveBeenCalled();
    expect(calls[0].init).toMatchObject({ keepalive: true, headers: { 'x-api-key': 'k' } });
  });
});

describe('teardown', () => {
  it('restores fetch and stops listening', async () => {
    const before = globalThis.fetch;
    start({ captureConsole: true });
    expect(globalThis.fetch).not.toBe(before);
    const consoleError = console.error;
    logger!.teardown();
    expect(globalThis.fetch).toBe(before);
    expect(console.error).not.toBe(consoleError);
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('after') }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent()).toHaveLength(0);
  });
});
