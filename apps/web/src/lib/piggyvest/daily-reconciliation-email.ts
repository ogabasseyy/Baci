import 'server-only';
import { zeptoMailRequest } from '@/lib/zeptomail-transport';

/**
 * Sends the daily report to the owner. Deliberately lean: the general email
 * module reaches the service-role client for audit rows and sender lookup,
 * which a read-only cron has no business holding. This one posts a single
 * message through the plain transport with the platform token, never retries
 * (a retry after a timeout could duplicate it) and writes no database row.
 * A failure is returned, not thrown; the caller pages on it.
 */
export async function sendReconciliationEmail(
  message: {
    to: string;
    subject: string;
    textContent: string;
    htmlContent: string;
  },
  env: NodeJS.ProcessEnv = process.env
): Promise<{ success: boolean }> {
  const token = env.ZEPTOMAIL_TOKEN?.trim();
  if (!token) return { success: false };
  const domain = env.ZEPTOMAIL_FROM_DOMAIN?.trim() || 'usebaci.com';
  try {
    await zeptoMailRequest(
      'email',
      {
        from: {
          address: `notifications@${domain}`,
          name: 'Baci Notifications',
        },
        to: [{ email_address: { address: message.to, name: message.to } }],
        subject: message.subject,
        htmlbody: message.htmlContent,
        textbody: message.textContent,
      },
      token
    );
    return { success: true };
  } catch {
    return { success: false };
  }
}
