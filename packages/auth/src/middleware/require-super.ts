import { type EventHandler, defineEventHandler, setResponseStatus } from 'h3';

// Standalone middleware form: `app.use('/path/**', requireSuper())`.
export function requireSuper(): EventHandler {
  return defineEventHandler((event) => {
    const user = event.context.user;
    if (!user) {
      setResponseStatus(event, 401);
      return { error: 'auth_required' };
    }
    if (!user.isSuper) {
      setResponseStatus(event, 403);
      return { error: 'forbidden' };
    }
  });
}

// Per-route wrapping form: `router.post('/path', withSuper(handler))`.
export function withSuper(handler: EventHandler): EventHandler {
  return defineEventHandler(async (event) => {
    const user = event.context.user;
    if (!user) {
      setResponseStatus(event, 401);
      return { error: 'auth_required' };
    }
    if (!user.isSuper) {
      setResponseStatus(event, 403);
      return { error: 'forbidden' };
    }
    return await handler(event);
  });
}
