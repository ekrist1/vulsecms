import { describe, expect, it, vi } from 'vitest';
import { sendResetEmail } from '../email.js';

describe('sendResetEmail', () => {
  it('logs to stdout when smtpUrl is undefined', async () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await sendResetEmail({ email: 'a@b.com', name: 'Anna' }, 'https://x/reset?token=t', undefined);
    const written = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('Password reset for a@b.com');
    expect(written).toContain('https://x/reset?token=t');
    spy.mockRestore();
  });
});
