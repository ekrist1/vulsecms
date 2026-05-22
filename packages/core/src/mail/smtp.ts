import { createTransport } from 'nodemailer';
import type { MailTransport } from './mailer.js';

export function smtpTransport(smtpUrl: string): MailTransport {
  const transport = createTransport(smtpUrl);
  return {
    async send(message) {
      await transport.sendMail({
        to: message.to,
        from: message.from,
        subject: message.subject,
        ...(message.text !== undefined ? { text: message.text } : {}),
        ...(message.html !== undefined ? { html: message.html } : {}),
        ...(message.attachments ? { attachments: message.attachments } : {}),
      });
    },
  };
}
