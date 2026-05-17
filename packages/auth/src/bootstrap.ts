import type { DatabaseAdapter } from '@vulse/db';
import { hashPassword } from 'better-auth/crypto';
import { randomBytes } from 'node:crypto';
import { ulid } from 'ulid';

export interface BootstrapOptions {
  adapter: DatabaseAdapter;
  bootstrapEmail: string | undefined;
  bootstrapPassword: string | undefined;
  isProd: boolean;
}

export interface BootstrapResult {
  created: boolean;
  email: string;
  generatedPassword?: string;
}

function randomPassword(): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) out += charset[bytes[i]! % charset.length];
  return out;
}

export async function seedSuperUser(opts: BootstrapOptions): Promise<BootstrapResult> {
  const existing = await opts.adapter.queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM users');
  if ((existing?.c ?? 0) > 0) {
    return { created: false, email: '' };
  }

  let email = opts.bootstrapEmail;
  let password = opts.bootstrapPassword;
  let generated: string | undefined;

  if (!email || !password) {
    if (opts.isProd) {
      throw new Error(
        'Refusing to start: set VULSE_BOOTSTRAP_EMAIL and VULSE_BOOTSTRAP_PASSWORD in production.',
      );
    }
    email = email ?? 'admin@vulse.local';
    generated = randomPassword();
    password = generated;
  }

  const userId = ulid();
  const accountId = ulid();
  const hashed = await hashPassword(password);

  await opts.adapter.exec('BEGIN');
  try {
    await opts.adapter.exec(
      `INSERT INTO users (id, email, email_verified, name, role, is_super, created_at, updated_at)
       VALUES (?, ?, 0, NULL, 'editor', 1, datetime('now'), datetime('now'))`,
      [userId, email],
    );
    await opts.adapter.exec(
      `INSERT INTO accounts (id, user_id, account_id, provider_id, password, created_at, updated_at)
       VALUES (?, ?, ?, 'credential', ?, datetime('now'), datetime('now'))`,
      [accountId, userId, email, hashed],
    );
    await opts.adapter.exec('COMMIT');
  } catch (err) {
    await opts.adapter.exec('ROLLBACK');
    throw err;
  }

  if (generated) {
    process.stdout.write(
      `\n[vulse:auth] First-boot super user seeded.\n  Email: ${email}\n  Password: ${generated}\n  (Set VULSE_BOOTSTRAP_EMAIL/PASSWORD to control this.)\n\n`,
    );
  }

  return { created: true, email, ...(generated ? { generatedPassword: generated } : {}) };
}
