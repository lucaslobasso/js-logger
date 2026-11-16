import { ErrorHandler, type Provider } from '@angular/core';

import type { Logger } from './types';
import { getLogger } from './util';

/** Angular ErrorHandler that logs every uncaught error, then prints it like the default handler. */
export class JsLoggerErrorHandler implements ErrorHandler {
  constructor(private readonly logger?: Logger) {}

  handleError(error: unknown): void {
    // Errors from zone-wrapped promises arrive as { rejection }.
    const actual = (error as { rejection?: unknown } | null)?.rejection ?? error;
    (this.logger ?? getLogger())?.exception(actual, { framework: 'angular' });
    console.error(error);
  }
}

/** Add to `providers` (bootstrapApplication or an NgModule). */
export function provideJsLogger(logger?: Logger): Provider {
  return { provide: ErrorHandler, useValue: new JsLoggerErrorHandler(logger) };
}
