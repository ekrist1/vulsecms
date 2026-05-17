import { createTransport } from 'nodemailer';

export interface ResetEmailUser {
  email: string;
  name: string | null;
}

export async function sendResetEmail(
  user: ResetEmailUser,
  resetUrl: string,
  smtpUrl: string | undefined,
): Promise<void> {
  if (!smtpUrl) {
    process.stdout.write(
      `\n[vulse:auth] Password reset for ${user.email}\n  ${resetUrl}\n\n`,
    );
    return;
  }
  const transport = createTransport(smtpUrl);
  await transport.sendMail({
    to: user.email,
    from: 'no-reply@vulse.local',
    subject: 'Reset your Vulse password',
    text: `Hello ${user.name ?? ''},\n\nClick this link to reset your password:\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
  });
}
