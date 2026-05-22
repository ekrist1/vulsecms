import { describe, expect, it, vi } from 'vitest';
import { type MailTransport, createMailer } from './mailer.js';

function captureTransport(): MailTransport & { sent: Parameters<MailTransport['send']>[0][] } {
  const sent: Parameters<MailTransport['send']>[0][] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}

describe('createMailer', () => {
  it('renders the registered template for an event and sends it', async () => {
    const transport = captureTransport();
    const mailer = createMailer({ transport, from: 'no-reply@vulse.local' });
    mailer.register('user.registered', {
      subject: (ctx) => `Welcome ${ctx.name ?? ctx.email}`,
      text: (ctx) => `Hi ${ctx.email}, welcome!`,
    });

    await mailer.send('user.registered', {
      to: 'a@b.com',
      context: { userId: 'u1', email: 'a@b.com', name: 'Ada' },
    });

    expect(transport.sent).toEqual([
      {
        to: 'a@b.com',
        from: 'no-reply@vulse.local',
        subject: 'Welcome Ada',
        text: 'Hi a@b.com, welcome!',
      },
    ]);
  });

  it('lets a later register() call replace an existing template', async () => {
    const transport = captureTransport();
    const mailer = createMailer({ transport, from: 'from@v.local' });
    mailer.register('user.registered', {
      subject: () => 'first',
      text: () => 'first body',
    });
    mailer.register('user.registered', {
      subject: () => 'second',
      text: () => 'second body',
    });

    await mailer.send('user.registered', {
      to: 'x@y',
      context: { userId: '1', email: 'x@y', name: null },
    });

    expect(transport.sent[0]?.subject).toBe('second');
    expect(transport.sent[0]?.text).toBe('second body');
  });

  it('supports attachments returned from the template', async () => {
    const transport = captureTransport();
    const mailer = createMailer({ transport, from: 'from@v.local' });
    mailer.register('user.registered', {
      subject: () => 'Welcome',
      text: () => 'body',
      attachments: () => [{ filename: 'guide.pdf', content: Buffer.from('pdf') }],
    });

    await mailer.send('user.registered', {
      to: 'x@y',
      context: { userId: '1', email: 'x@y', name: null },
    });

    expect(transport.sent[0]?.attachments).toEqual([
      { filename: 'guide.pdf', content: Buffer.from('pdf') },
    ]);
  });

  it('supports html in addition to text', async () => {
    const transport = captureTransport();
    const mailer = createMailer({ transport, from: 'from@v.local' });
    mailer.register('user.registered', {
      subject: () => 's',
      text: () => 't',
      html: (ctx) => `<p>hi ${ctx.email}</p>`,
    });
    await mailer.send('user.registered', {
      to: 'x@y',
      context: { userId: '1', email: 'x@y', name: null },
    });
    expect(transport.sent[0]?.html).toBe('<p>hi x@y</p>');
  });

  it('throws when sending an event with no registered template', async () => {
    const mailer = createMailer({ transport: captureTransport(), from: 'f@v' });
    await expect(
      mailer.send('user.registered', {
        to: 'x@y',
        context: { userId: '1', email: 'x@y', name: null },
      }),
    ).rejects.toThrow(/no email template registered for user\.registered/);
  });

  it('logTransport writes to the provided stream instead of sending', async () => {
    const { logTransport } = await import('./mailer.js');
    const chunks: string[] = [];
    const t = logTransport({ write: (s) => chunks.push(s) });
    await t.send({ to: 'a@b', from: 'c@d', subject: 's', text: 'hello' });
    expect(chunks.join('')).toContain('To: a@b');
    expect(chunks.join('')).toContain('Subject: s');
    expect(chunks.join('')).toContain('hello');
  });
});

describe('bus integration', () => {
  it('sendOnEvent subscribes a mailer to a bus event', async () => {
    const { createEventBus } = await import('../bus.js');
    const transport = captureTransport();
    const mailer = createMailer({ transport, from: 'f@v' });
    mailer.register('user.registered', {
      subject: () => 'hey',
      text: (c) => `welcome ${c.email}`,
    });
    const bus = createEventBus();

    mailer.sendOnEvent(bus, 'user.registered', (payload) => ({
      to: payload.email,
      context: payload,
    }));

    await bus.emit('user.registered', { userId: 'u', email: 'a@b', name: null });

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.to).toBe('a@b');
  });

  it('a custom listener can opt out by returning null', async () => {
    const { createEventBus } = await import('../bus.js');
    const transport = captureTransport();
    const mailer = createMailer({ transport, from: 'f@v' });
    mailer.register('user.registered', { subject: () => 's', text: () => 't' });
    const bus = createEventBus();

    mailer.sendOnEvent(bus, 'user.registered', () => null);
    await bus.emit('user.registered', { userId: 'u', email: 'a@b', name: null });

    expect(transport.sent).toHaveLength(0);
  });
});
