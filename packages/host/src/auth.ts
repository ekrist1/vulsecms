import type { Client } from '@libsql/client';
import { type AuthInstance, type AuthInstanceEnv, createAuth } from '@vulse/auth';
import type { EventBus } from '@vulse/core';

export interface DefaultAuthOptions {
  client: Client;
  env: AuthInstanceEnv;
  bus: EventBus;
}

/**
 * Create an AuthInstance with callbacks already wired to the given bus:
 *
 *   - `user.registered` is emitted when better-auth creates a user
 *     (admin route uses a separate path; see createApi onUserCreated).
 *   - `user.password_reset_requested` is emitted when better-auth requests
 *     a reset link. The default mailer (see createDefaultMailer) listens
 *     and sends the email.
 */
export function createDefaultAuth(opts: DefaultAuthOptions): AuthInstance {
  return createAuth({
    client: opts.client,
    env: opts.env,
    callbacks: {
      onUserCreated: (user) =>
        opts.bus.emit('user.registered', {
          userId: user.id,
          email: user.email,
          name: user.name,
        }),
      sendResetEmail: (user, resetUrl) =>
        opts.bus.emit('user.password_reset_requested', {
          userId: '',
          email: user.email,
          name: user.name,
          resetUrl,
        }),
    },
  });
}
