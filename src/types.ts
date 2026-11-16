export type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/** Where an event came from. */
export type Source = 'manual' | 'error' | 'resource' | 'unhandledrejection' | 'fetch' | 'xhr' | 'console';

export type Context = Record<string, unknown>;

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  cause?: SerializedError;
}

/** One log event, as it is sent to your endpoint (inside `{ "events": [...] }`). */
export interface LogEvent {
  level: Level;
  message: string;
  source: Source;
  /** ISO 8601. */
  timestamp: string;
  /** Page the event happened on. */
  url?: string;
  userAgent?: string;
  app?: string;
  release?: string;
  user?: Context;
  context?: Context;
  error?: SerializedError;
  /** Short hash of level + message + top stack frame: group or dedupe by it. */
  fingerprint: string;
}

export interface Options {
  /** URL that receives `POST { events: LogEvent[] }` as JSON. Relative URLs resolve against the page. */
  endpoint: string;
  /** Lowest level that is sent. Default `'info'`. */
  level?: Level;
  /** Your app's name, added to every event. */
  app?: string;
  /** Version or commit, added to every event. */
  release?: string;
  /** Extra fields added to every event (merged with `setContext`). */
  context?: Context;
  /** Extra request headers, e.g. an API key. With headers set, the unload flush uses `fetch(keepalive)` instead of `sendBeacon`. */
  headers?: Record<string, string>;
  /** `fetch` credentials mode for log requests. Default `'same-origin'`. */
  credentials?: RequestCredentials;
  /** Events per request; a full batch is sent at once. Default 10. */
  batchSize?: number;
  /** Milliseconds to wait for more events before sending a partial batch. Default 2000. */
  flushInterval?: number;
  /** Events kept in memory while the endpoint is unreachable; the oldest are dropped. Default 100. */
  maxQueue?: number;
  /** Retries for a failed request (1 s, 2 s, 4 s...). Default 3. */
  retries?: number;
  /** Identical events (same fingerprint) within this many ms are sent once. Default 5000, 0 = off. */
  dedupeMs?: number;
  /** Share of events to keep, 0 to 1. Default 1. */
  sampleRate?: number;
  /** Mask emails, and values of keys like password / token / authorization / cookie. Default true. */
  redact?: boolean;
  /** Last look at each event: return it (changed or not) to send, or a falsy value to drop it. */
  beforeSend?: (event: LogEvent) => LogEvent | null | undefined | false;
  /** `window` error events: uncaught exceptions and failed <script>/<img>/<link> loads. Default true. */
  captureErrors?: boolean;
  /** Unhandled promise rejections. Default true. */
  captureRejections?: boolean;
  /** `fetch` calls that fail or answer 4xx/5xx. Default true. */
  captureFetch?: boolean;
  /** `XMLHttpRequest` calls (and so jQuery / axios) that fail or answer 4xx/5xx. Default true. */
  captureXhr?: boolean;
  /** `console.error` and `console.warn` calls. Default false. */
  captureConsole?: boolean;
}

export interface Logger {
  trace(message: unknown, context?: Context): void;
  debug(message: unknown, context?: Context): void;
  info(message: unknown, context?: Context): void;
  warn(message: unknown, context?: Context): void;
  error(message: unknown, context?: Context): void;
  fatal(message: unknown, context?: Context): void;
  log(level: Level, message: unknown, context?: Context): void;
  /** Logs a caught error at `error` level with its stack and cause chain. */
  exception(error: unknown, context?: Context): void;
  /** Attach a user (id, name...) to every following event; `null` clears it. */
  setUser(user: Context | null): void;
  /** Merge fields into the context sent with every following event. */
  setContext(context: Context): void;
  /** Send everything queued now. */
  flush(): Promise<void>;
  /** Stop capturing and restore every patched global (fetch, XHR, console, listeners). */
  teardown(): void;
}
