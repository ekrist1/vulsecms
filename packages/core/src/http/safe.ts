import { type EventHandler, type H3Event, defineEventHandler, setResponseStatus } from 'h3';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';

/**
 * Wraps an event-handler body so that our domain error classes
 * (`ValidationError`, `NotFoundError`, `ConflictError`) are converted to
 * stable JSON responses. Other errors are re-thrown so h3's default
 * error handling can run.
 */
export function safe(fn: (event: H3Event) => unknown | Promise<unknown>): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      return await fn(event);
    } catch (err) {
      if (err instanceof ValidationError) {
        setResponseStatus(event, 422);
        return { error: 'validation', issues: err.issues };
      }
      if (err instanceof NotFoundError) {
        setResponseStatus(event, 404);
        return { error: 'not_found', message: err.message };
      }
      if (err instanceof ConflictError) {
        setResponseStatus(event, 409);
        return { error: 'conflict', message: err.message };
      }
      throw err;
    }
  });
}
