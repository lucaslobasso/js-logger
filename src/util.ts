import type { Logger, SerializedError } from './types';

// The active logger lives on globalThis so the framework adapters (separate bundles)
// and a <script> build on the same page all see the same instance.
const KEY = '__jsLogger__';
type Holder = { [KEY]?: Logger | null };

export function getLogger(): Logger | null {
  return (globalThis as Holder)[KEY] ?? null;
}

export function setActive(logger: Logger | null): void {
  (globalThis as Holder)[KEY] = logger;
}

export function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function serializeError(error: unknown, depth = 0): SerializedError {
  if (error instanceof Error) {
    const out: SerializedError = { name: error.name, message: error.message };
    if (error.stack) out.stack = error.stack;
    const cause = (error as { cause?: unknown }).cause;
    if (cause !== undefined && depth < 3) out.cause = serializeError(cause, depth + 1);
    return out;
  }
  return { name: 'NonError', message: stringify(error) };
}

/** djb2, base 36: short and stable, not cryptographic. */
export function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = (h * 33) ^ text.charCodeAt(i);
  return (h >>> 0).toString(36);
}

const SECRET_KEY = /passw|secret|token|authori[sz]ation|cookie|session|api[-_]?key|^pwd$/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const INLINE_SECRET = /((?:password|passwd|pwd|token|secret|api[-_]?key|authorization)["']?\s*[:=]\s*["']?)[^\s"'&,;]+/gi;

export function redactText(text: string): string {
  return text.replace(EMAIL, '[email]').replace(INLINE_SECRET, '$1[redacted]');
}

export function redact<T>(value: T, depth = 0): T {
  if (typeof value === 'string') return redactText(value) as T;
  if (!value || typeof value !== 'object' || depth > 6) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
  return out as T;
}
