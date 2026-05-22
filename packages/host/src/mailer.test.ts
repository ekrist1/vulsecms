import { type MailTransport, createEventBus } from '@vulse/core';
import { describe, expect, it } from 'vitest';
import { createDefaultMailer } from './mailer.js';

interface CapturedMessage {
  to: string | string[];
  subject: string;
  text?: string;
}

function captureTransport(captured: CapturedMessage[]): MailTransport {
  return {
    async send(m) {
      captured.push({
        to: m.to,
        subject: m.subject,
        ...(m.text ? { text: m.text } : {}),
      });
    },
  };
}

describe('createDefaultMailer', () => {
  it('registers user.registered and user.password_reset_requested templates and wires them to the bus', async () => {
    const captured: CapturedMessage[] = [];
    const bus = createEventBus();
    createDefaultMailer({
      bus,
      transport: captureTransport(captured),
      from: 'no-reply@vulse.test',
      baseUrl: 'https://example.test',
    });

    await bus.emit('user.registered', { userId: 'u1', email: 'a@b.com', name: 'Ada' });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.to).toBe('a@b.com');
    expect(captured[0]?.subject).toContain('Welcome');
    expect(captured[0]?.subject).toContain('Ada');
    expect(captured[0]?.text).toContain('https://example.test');

    await bus.emit('user.password_reset_requested', {
      userId: '',
      email: 'a@b.com',
      name: 'Ada',
      resetUrl: 'https://example.test/reset?t=abc',
    });
    expect(captured).toHaveLength(2);
    expect(captured[1]?.subject).toContain('Reset');
    expect(captured[1]?.text).toContain('https://example.test/reset?t=abc');
  });

  it('returns the mailer so the caller can override templates', async () => {
    const captured: CapturedMessage[] = [];
    const bus = createEventBus();
    const mailer = createDefaultMailer({
      bus,
      transport: captureTransport(captured),
      from: 'no-reply@vulse.test',
      baseUrl: 'https://example.test',
    });
    mailer.register('user.registered', {
      subject: () => 'Custom welcome',
      text: () => 'Custom body',
    });

    await bus.emit('user.registered', { userId: 'u', email: 'x@y.z', name: null });
    expect(captured[0]?.subject).toBe('Custom welcome');
    expect(captured[0]?.text).toBe('Custom body');
  });
});
