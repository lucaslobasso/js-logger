import { describe, expect, it, vi } from 'vitest';

import { JsLoggerErrorHandler, provideJsLogger } from '../src/angular';
import { ErrorBoundary } from '../src/react';
import type { Logger } from '../src/types';
import { jsLoggerPlugin } from '../src/vue';

const fakeLogger = () => ({ exception: vi.fn() }) as unknown as Logger & { exception: ReturnType<typeof vi.fn> };

describe('vue plugin', () => {
  it('logs and chains to the previous errorHandler', () => {
    const logger = fakeLogger();
    const previous = vi.fn();
    const app = { config: { errorHandler: previous } } as never as Parameters<typeof jsLoggerPlugin.install>[0];
    jsLoggerPlugin.install(app, { logger });
    const err = new Error('render');
    app.config.errorHandler!(err, { $options: { name: 'Cart' } } as never, 'render function');
    expect(logger.exception).toHaveBeenCalledWith(err, { info: 'render function', component: 'Cart' });
    expect(previous).toHaveBeenCalledWith(err, expect.anything(), 'render function');
  });
});

describe('angular handler', () => {
  it('unwraps zone rejections and logs', () => {
    const logger = fakeLogger();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('async');
    new JsLoggerErrorHandler(logger).handleError({ rejection: err });
    expect(logger.exception).toHaveBeenCalledWith(err, { framework: 'angular' });
    expect(provideJsLogger(logger)).toMatchObject({ useValue: expect.any(JsLoggerErrorHandler) });
  });
});

describe('react error boundary', () => {
  it('logs with the component stack and renders the fallback', () => {
    const logger = fakeLogger();
    const boundary = new ErrorBoundary({ logger, fallback: (e: Error) => `failed: ${e.message}` });
    const err = new Error('render');
    boundary.componentDidCatch(err, { componentStack: '\n    at Cart' } as never);
    expect(logger.exception).toHaveBeenCalledWith(err, { componentStack: '\n    at Cart' });
    boundary.state = ErrorBoundary.getDerivedStateFromError(err);
    expect(boundary.render()).toBe('failed: render');
  });
});
