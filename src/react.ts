import { Component, type ErrorInfo, type ReactNode } from 'react';

import type { Logger } from './types';
import { getLogger } from './util';

export interface ErrorBoundaryProps {
  children?: ReactNode;
  /** Shown instead of the children after a render error. A function gets the error and a reset callback. */
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  /** Defaults to the logger from `init()`. */
  logger?: Logger;
}

interface State {
  error: Error | null;
}

/** Logs render errors below it (with the component stack) and shows `fallback`. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    (this.props.logger ?? getLogger())?.exception(error, { componentStack: info.componentStack ?? undefined });
  }

  reset = (): void => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children ?? null;
    const { fallback } = this.props;
    return typeof fallback === 'function' ? fallback(error, this.reset) : (fallback ?? null);
  }
}

/** The logger from `init()`, or null before it ran. */
export function useLogger(): Logger | null {
  return getLogger();
}
