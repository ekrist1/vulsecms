import type { EventBus, VulseEvents } from '../bus.js';

export interface MailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export interface OutgoingMessage {
  to: string | string[];
  from: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: MailAttachment[];
}

export interface MailTransport {
  send(message: OutgoingMessage): Promise<void>;
}

// A template renders the four parts of an email from an event context.
// Each field is a function so callers can interpolate freely without us
// inventing a template DSL.
export interface MailTemplate<Ctx> {
  subject: (context: Ctx) => string;
  text?: (context: Ctx) => string;
  html?: (context: Ctx) => string;
  attachments?: (context: Ctx) => MailAttachment[] | Promise<MailAttachment[]>;
}

export interface SendArgs<Ctx> {
  to: string | string[];
  context: Ctx;
  // Per-send overrides: pin the from address or attach extra files
  // for this one message without touching the registered template.
  from?: string;
  extraAttachments?: MailAttachment[];
}

export interface Mailer {
  register<K extends keyof VulseEvents>(event: K, template: MailTemplate<VulseEvents[K]>): void;
  // Allow registering templates keyed by a free-form string so plugins
  // can define their own template keys without augmenting VulseEvents.
  registerByKey<Ctx>(key: string, template: MailTemplate<Ctx>): void;
  send<K extends keyof VulseEvents>(event: K, args: SendArgs<VulseEvents[K]>): Promise<void>;
  sendByKey<Ctx>(key: string, args: SendArgs<Ctx>): Promise<void>;
  sendOnEvent<K extends keyof VulseEvents>(
    bus: EventBus,
    event: K,
    map: (payload: VulseEvents[K]) => SendArgs<VulseEvents[K]> | null,
  ): void;
}

export interface MailerOptions {
  transport: MailTransport;
  from: string;
}

export function createMailer(options: MailerOptions): Mailer {
  const templates = new Map<string, MailTemplate<unknown>>();

  async function sendByKey<Ctx>(key: string, args: SendArgs<Ctx>): Promise<void> {
    const template = templates.get(key) as MailTemplate<Ctx> | undefined;
    if (!template) {
      throw new Error(`no email template registered for ${key}`);
    }
    const subject = template.subject(args.context);
    const text = template.text?.(args.context);
    const html = template.html?.(args.context);
    const baseAttachments = template.attachments
      ? await template.attachments(args.context)
      : undefined;
    const attachments =
      baseAttachments || args.extraAttachments
        ? [...(baseAttachments ?? []), ...(args.extraAttachments ?? [])]
        : undefined;
    const message: OutgoingMessage = {
      to: args.to,
      from: args.from ?? options.from,
      subject,
      ...(text !== undefined ? { text } : {}),
      ...(html !== undefined ? { html } : {}),
      ...(attachments ? { attachments } : {}),
    };
    await options.transport.send(message);
  }

  return {
    register(event, template) {
      templates.set(event as string, template as MailTemplate<unknown>);
    },
    registerByKey(key, template) {
      templates.set(key, template as MailTemplate<unknown>);
    },
    send(event, args) {
      return sendByKey(event as string, args);
    },
    sendByKey,
    sendOnEvent(bus, event, map) {
      bus.on(event, async (payload) => {
        const args = map(payload);
        if (!args) return;
        await sendByKey(event as string, args);
      });
    },
  };
}

// Transport that writes to a stream instead of dialing SMTP. Used for
// development and tests.
export function logTransport(stream: { write: (s: string) => void }): MailTransport {
  return {
    async send(message) {
      const lines = [
        '--- vulse:mail ---',
        `To: ${Array.isArray(message.to) ? message.to.join(', ') : message.to}`,
        `From: ${message.from}`,
        `Subject: ${message.subject}`,
      ];
      if (message.text) lines.push('', message.text);
      if (message.html) lines.push('', `[html] ${message.html}`);
      if (message.attachments?.length) {
        lines.push('', `Attachments: ${message.attachments.map((a) => a.filename).join(', ')}`);
      }
      lines.push('--- /vulse:mail ---', '');
      stream.write(`${lines.join('\n')}\n`);
    },
  };
}
