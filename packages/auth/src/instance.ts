import { type Client } from '@libsql/client';
import { APIError, betterAuth, type BetterAuthOptions } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/libsql';
import { sendResetEmail } from './email.js';
import { schema } from './drizzle-schema.js';

export interface AuthInstanceEnv {
  authSecret: string;
  baseUrl: string;
  allowPublicSignup: boolean;
  smtpUrl: string | undefined;
}

export function createAuth(opts: { client: Client; env: AuthInstanceEnv }) {
  const db = drizzle(opts.client, { schema });

  const isHttps = opts.env.baseUrl.startsWith('https://');

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
        await sendResetEmail(
          { email: user.email, name: user.name ?? null },
          url,
          opts.env.smtpUrl,
        );
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
