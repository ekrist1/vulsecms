import {
  type EventBus,
  type MailTransport,
  type Mailer,
  createMailer,
  logTransport,
  smtpTransport,
} from '@vulse/core';

export interface DefaultMailerOptions {
  bus: EventBus;
  // The base URL of the admin/site, used inside default welcome copy.
  baseUrl: string;
  // From address. Required.
  from: string;
  // One of the two must be supplied. If neither is supplied, log transport
  // is used so dev environments don't need SMTP set up.
  smtpUrl?: string;
  transport?: MailTransport;
}

/**
 * Build a Mailer pre-configured with the two emails Vulse ships out of the
 * box (welcome + password reset), and wired to the given bus so they fire
 * automatically when those events are emitted.
 *
 * Callers can override either template by calling `mailer.register(event, ...)`
 * again after this function returns.
 */
export function createDefaultMailer(opts: DefaultMailerOptions): Mailer {
  const transport: MailTransport =
    opts.transport ?? (opts.smtpUrl ? smtpTransport(opts.smtpUrl) : logTransport(process.stdout));
  const mailer = createMailer({ transport, from: opts.from });

  mailer.register('user.registered', {
    subject: (ctx) => `Welcome to Vulse, ${ctx.name ?? ctx.email}`,
    text: (ctx) =>
      `Hi ${ctx.name ?? ctx.email},\n\nYour Vulse account is ready.\nSign in at ${opts.baseUrl}/admin\n\n— Vulse`,
  });
  mailer.register('user.password_reset_requested', {
    subject: () => 'Reset your Vulse password',
    text: (ctx) =>
      `Hello ${ctx.name ?? ''},\n\nClick this link to reset your password:\n${ctx.resetUrl}\n\nIf you did not request this, ignore this email.`,
  });

  mailer.sendOnEvent(opts.bus, 'user.registered', (p) => ({ to: p.email, context: p }));
  mailer.sendOnEvent(opts.bus, 'user.password_reset_requested', (p) => ({
    to: p.email,
    context: p,
  }));

  return mailer;
}
