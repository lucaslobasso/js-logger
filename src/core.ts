import type { Context, Level, LogEvent, Logger, Options, Source } from './types';
import { getLogger, hash, redact, serializeError, setActive, stringify } from './util';

const LEVELS: Level[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

type AnyFn = (...args: any[]) => any;

/**
 * Starts logging: hooks the global error sources you enable and returns the logger.
 * Calling it again replaces the previous logger (its hooks are removed first).
 */
export function init(options: Options): Logger {
  if (!options || !options.endpoint) throw new Error('jsLogger: `endpoint` is required');
  getLogger()?.teardown();

  const o = {
    level: 'info' as Level,
    batchSize: 10,
    flushInterval: 2000,
    maxQueue: 100,
    retries: 3,
    dedupeMs: 5000,
    sampleRate: 1,
    redact: true,
    captureErrors: true,
    captureRejections: true,
    captureFetch: true,
    captureXhr: true,
    captureConsole: false,
    ...options,
  };

  const g = globalThis as any;
  const win: (Window & typeof globalThis) | undefined = typeof window !== 'undefined' ? window : undefined;
  const nativeFetch: typeof fetch | undefined = g.fetch ? g.fetch.bind(g) : undefined;
  const nativeWarn = console.warn.bind(console);
  const base = () => win?.location?.href ?? 'http://localhost/';
  const endpoint = new URL(o.endpoint, base()).href;
  const strip = (url: string) => url.split(/[?#]/)[0];
  const isOwn = (url: string) => {
    try {
      return strip(new URL(url, base()).href) === strip(endpoint);
    } catch {
      return false;
    }
  };

  let user: Context | undefined;
  let context: Context = { ...o.context };
  let queue: LogEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;
  let warned = false;
  const seen = new Map<string, number>();
  const undo: Array<() => void> = [];

  function capture(level: Level, input: unknown, ctx: Context | undefined, source: Source): void {
    if (busy || LEVELS.indexOf(level) < LEVELS.indexOf(o.level)) return;
    if (o.sampleRate < 1 && Math.random() >= o.sampleRate) return;
    busy = true; // a console.error inside beforeSend (or ours) must not log itself
    try {
      const error = input instanceof Error ? serializeError(input) : undefined;
      const merged = { ...context, ...ctx };
      let event: LogEvent = {
        level,
        message: stringify(input),
        source,
        timestamp: new Date().toISOString(),
        url: win?.location?.href,
        userAgent: g.navigator?.userAgent,
        app: o.app,
        release: o.release,
        user,
        context: Object.keys(merged).length ? merged : undefined,
        error,
        fingerprint: hash(level + stringify(input) + (error?.stack?.split('\n')[1] ?? '')),
      };

      if (o.dedupeMs > 0) {
        const now = Date.now();
        const last = seen.get(event.fingerprint);
        if (last !== undefined && now - last < o.dedupeMs) return;
        seen.set(event.fingerprint, now);
        if (seen.size > 200) seen.delete(seen.keys().next().value as string);
      }
      if (o.redact) event = redact(event);
      if (o.beforeSend) {
        const kept = o.beforeSend(event);
        if (!kept) return;
        event = kept;
      }

      queue.push(event);
      if (queue.length > o.maxQueue) queue.shift();
      if (queue.length >= o.batchSize) void flush();
      else if (!timer) timer = setTimeout(() => void flush(), o.flushInterval);
    } finally {
      busy = false;
    }
  }

  async function send(events: LogEvent[], attempt = 0): Promise<void> {
    if (!nativeFetch) return;
    try {
      const res = await nativeFetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...o.headers },
        body: JSON.stringify({ events }),
        credentials: o.credentials ?? 'same-origin',
      });
      if (res.ok) return;
      // 4xx (except 429) will not get better by retrying.
      if (res.status < 500 && res.status !== 429) throw Object.assign(new Error(`HTTP ${res.status}`), { final: true });
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if ((e as { final?: boolean }).final || attempt >= o.retries) {
        if (!warned) nativeWarn(`jsLogger: dropped ${events.length} event(s), ${endpoint} failed: ${(e as Error).message}`);
        warned = true;
        return;
      }
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      return send(events, attempt + 1);
    }
  }

  async function flush(): Promise<void> {
    clearTimeout(timer);
    timer = undefined;
    const sends: Promise<void>[] = [];
    while (queue.length) sends.push(send(queue.splice(0, o.batchSize)));
    await Promise.all(sends);
  }

  /** The page is going away: hand everything to the browser in one request that outlives the page. */
  function flushOnExit(): void {
    if (!queue.length) return;
    clearTimeout(timer);
    timer = undefined;
    const body = JSON.stringify({ events: queue });
    queue = [];
    const nav = g.navigator;
    // text/plain keeps a cross-origin beacon a "simple" request (no CORS preflight, which beacons cannot do).
    if (!o.headers && nav?.sendBeacon?.(endpoint, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return;
    nativeFetch?.(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...o.headers },
      body,
      keepalive: true,
      credentials: o.credentials ?? 'same-origin',
    }).catch(() => {});
  }

  function listen(target: EventTarget, type: string, fn: (e: any) => void, capturePhase = false): void {
    target.addEventListener(type, fn, capturePhase);
    undo.push(() => target.removeEventListener(type, fn, capturePhase));
  }

  function patch<T extends object, K extends keyof T>(obj: T, key: K, wrap: (orig: T[K]) => T[K]): void {
    const orig = obj[key];
    obj[key] = wrap(orig);
    undo.push(() => {
      obj[key] = orig;
    });
  }

  if (win) {
    listen(win, 'pagehide', flushOnExit);
    listen(win.document, 'visibilitychange', () => {
      if (win.document.visibilityState === 'hidden') flushOnExit();
    });

    if (o.captureErrors) {
      // Capture phase, so failed <img>/<script>/<link> loads (which do not bubble) are seen too.
      listen(
        win,
        'error',
        (e: ErrorEvent) => {
          const el = e.target as (Element & { src?: string; href?: string }) | null;
          if (el && el !== (win as unknown) && el.tagName) {
            const src = el.src || el.href;
            if (src && !isOwn(src)) capture('error', `Failed to load <${el.tagName.toLowerCase()}> ${src}`, undefined, 'resource');
            return;
          }
          const where = e.filename ? { file: e.filename, line: e.lineno, column: e.colno } : undefined;
          capture('error', e.error ?? e.message, where, 'error');
        },
        true,
      );
    }
    if (o.captureRejections) {
      listen(win, 'unhandledrejection', (e: PromiseRejectionEvent) =>
        capture('error', e.reason ?? 'Unhandled promise rejection', undefined, 'unhandledrejection'),
      );
    }
  }

  if (o.captureFetch && g.fetch) {
    patch(g, 'fetch', (orig: AnyFn) =>
      function (this: unknown, ...args: Parameters<typeof fetch>) {
        const [input, req] = args;
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const method = (req?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
        const result: Promise<Response> = orig.apply(this, args);
        if (isOwn(url)) return result;
        const ctx = { method, requestUrl: url };
        return result.then(
          (res) => {
            if (res.status >= 400) {
              capture('error', `${method} ${url} failed: ${res.status} ${res.statusText}`.trim(), { ...ctx, status: res.status }, 'fetch');
            }
            return res;
          },
          (err) => {
            if (err?.name !== 'AbortError') capture('error', `${method} ${url} failed: ${err?.message ?? err}`, ctx, 'fetch');
            throw err;
          },
        );
      },
    );
  }

  if (o.captureXhr && g.XMLHttpRequest) {
    const proto = g.XMLHttpRequest.prototype as XMLHttpRequest;
    const info = new WeakMap<XMLHttpRequest, { method: string; url: string }>();
    patch(proto, 'open', (orig: AnyFn) =>
      function (this: XMLHttpRequest, ...args: any[]) {
        info.set(this, { method: String(args[0]).toUpperCase(), url: String(args[1]) });
        return orig.apply(this, args);
      },
    );
    patch(proto, 'send', (orig: AnyFn) =>
      function (this: XMLHttpRequest, ...args: any[]) {
        const req = info.get(this);
        if (req && !isOwn(req.url)) {
          let aborted = false;
          this.addEventListener('abort', () => (aborted = true));
          this.addEventListener('loadend', () => {
            if (aborted || (this.status > 0 && this.status < 400)) return;
            const what = this.status ? `${this.status} ${this.statusText}`.trim() : 'network error';
            capture('error', `${req.method} ${req.url} failed: ${what}`, { method: req.method, requestUrl: req.url, status: this.status }, 'xhr');
          });
        }
        return orig.apply(this, args);
      },
    );
  }

  if (o.captureConsole) {
    for (const method of ['error', 'warn'] as const) {
      patch(console, method, (orig: AnyFn) =>
        function (...args: unknown[]) {
          const err = args.find((a) => a instanceof Error);
          capture(method, err ?? args.map(stringify).join(' '), undefined, 'console');
          return orig.apply(console, args);
        },
      );
    }
  }

  const at = (level: Level) => (message: unknown, ctx?: Context) => capture(level, message, ctx, 'manual');

  const logger: Logger = {
    trace: at('trace'),
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    fatal: at('fatal'),
    log: (level, message, ctx) => capture(level, message, ctx, 'manual'),
    exception: (error, ctx) => capture('error', error, ctx, 'manual'),
    setUser: (u) => {
      user = u ?? undefined;
    },
    setContext: (c) => {
      context = { ...context, ...c };
    },
    flush,
    teardown: () => {
      while (undo.length) undo.pop()!();
      clearTimeout(timer);
      timer = undefined;
      if (getLogger() === logger) setActive(null);
    },
  };
  setActive(logger);
  return logger;
}
