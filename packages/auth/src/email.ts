export interface ResetEmailUser {
  email: string;
  name: string | null;
}

/**
 * Stub. The real implementation arrives in Task A4 and will send the password
 * reset email via nodemailer using the provided SMTP URL.
 */
export async function sendResetEmail(
  _user: ResetEmailUser,
  _resetUrl: string,
  _smtpUrl: string | undefined,
): Promise<void> {
  // no-op stub; real implementation in Task A4
}
