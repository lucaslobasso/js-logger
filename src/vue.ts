import type { App } from 'vue';

import type { Logger } from './types';
import { getLogger } from './util';

export interface VuePluginOptions {
  /** Defaults to the logger from `init()`. */
  logger?: Logger;
}

/** `app.use(jsLoggerPlugin)`: logs errors from components, watchers and lifecycle hooks. Keeps any existing errorHandler. */
export const jsLoggerPlugin = {
  install(app: App, options: VuePluginOptions = {}): void {
    const previous = app.config.errorHandler;
    app.config.errorHandler = (err, instance, info) => {
      const name = instance?.$options?.name ?? instance?.$options?.__name;
      (options.logger ?? getLogger())?.exception(err, { info, component: name });
      if (previous) previous(err, instance, info);
      else console.error(err);
    };
  },
};
