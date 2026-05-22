import type { Client } from '@libsql/client';
import { APIError, type BetterAuthOptions, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware } from 'better-auth/api';
import { drizzle } from 'drizzle-orm/libsql';
import { schema } from './drizzle-schema.js';
import { sendResetEmail } from './email.js';

export interface AuthInstanceEnv {
  authSecret: string;
  baseUrl: string;
  allowPublicSignup: boolean;
  smtpUrl: string | undefined;
}

export interface AuthCallbacks {
  // Fires after better-auth commits a new user (e.g. public sign-up).
  // The host typically forwards this to bus.emit('user.registered', ...).
  onUserCreated?: (user: {
    id: string;
    email: string;
    name: string | null;
  }) => void | Promise<void>;
  // Overrides the default password-reset email. The host typically
  // forwards this through the core mailer so the template is customisable.
  sendResetEmail?: (
    user: { email: string; name: string | null },
    resetUrl: string,
  ) => void | Promise<void>;
}

export function createAuth(opts: {
  client: Client;
  env: AuthInstanceEnv;
  callbacks?: AuthCallbacks;
}) {
  const db = drizzle(opts.client, { schema });

  const isHttps = opts.env.baseUrl.startsWith('https://');
  const callbacks = opts.callbacks ?? {};

  const options: BetterAuthOptions = {
    secret: opts.env.authSecret,
    baseURL: opts.env.baseUrl,
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema,
      // Our tables use plural names (users, sessions, accounts, verifications)
      // while Better Auth defaults to singular model keys (user, session, ...).
      usePlural: true,
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      sendResetPassword: async ({ user, url }) => {
        if (callbacks.sendResetEmail) {
          await callbacks.sendResetEmail({ email: user.email, name: user.name ?? null }, url);
          return;
        }
        await sendResetEmail({ email: user.email, name: user.name ?? null }, url, opts.env.smtpUrl);
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            if (!callbacks.onUserCreated) return;
            await callbacks.onUserCreated({
              id: user.id,
              email: user.email,
              name: (user.name as string | null | undefined) ?? null,
            });
          },
        },
      },
    },
    user: {
      additionalFields: {
        role: {
          type: 'string',
          required: true,
          defaultValue: 'external_user',
          input: false,
          fieldName: 'role',
        },
        isSuper: {
          type: 'number',
          required: true,
          defaultValue: 0,
          input: false,
          fieldName: 'isSuper',
        },
      },
    },
    advanced: {
      // Force the session cookie name to "vulse_session" regardless of the
      // default `${cookiePrefix}.session_token` scheme.
      cookies: {
        session_token: {
          name: 'vulse_session',
          attributes: {
            sameSite: 'lax',
            httpOnly: true,
            secure: isHttps,
            path: '/',
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/sign-up/email' && !opts.env.allowPublicSignup) {
          throw new APIError('FORBIDDEN', { message: 'signup_disabled', error: 'signup_disabled' });
        }
      }),
    },
  };

  const auth = betterAuth(options);
  return {
    auth,
    db,
    client: opts.client,
    close: () => {}, // no-op: caller owns the client lifetime
  };
}

export type AuthInstance = ReturnType<typeof createAuth>;
