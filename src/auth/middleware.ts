import type { Context, MiddlewareHandler } from 'hono';
import type { AppConfig } from '../config/index.js';

export function apiAuthMiddleware(config: AppConfig): MiddlewareHandler {
  return async (c, next) => {
    if (config.apiAuthMode === 'none') {
      await next();
      return;
    }

    if (!config.apiBearerToken) {
      return writeAuthError(c, 'API bearer auth is enabled but no token is configured');
    }

    const authorization = c.req.header('authorization');
    if (authorization !== `Bearer ${config.apiBearerToken}`) {
      return writeAuthError(c, 'Missing or invalid bearer token');
    }

    await next();
  };
}

function writeAuthError(c: Context, message: string) {
  return c.json({ error: 'unauthorized', message }, 401);
}
