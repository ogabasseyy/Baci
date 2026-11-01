import {
  buildFeedbackReportEmail,
  FEEDBACK_INBOX_EMAIL,
  type FeedbackReportEmailInput,
} from '@/lib/feedback/feedback-report-email';
import { sendEmail } from '@/lib/zeptomail';

// The admin app aborts API calls after 20s. One bounded attempt keeps a slow
// provider from turning an already-saved report into a client timeout (and a
// duplicate report when the merchant taps Send again).
export const FEEDBACK_EMAIL_BUDGET_MS = 10_000;

/**
 * Audited in-app feedback sender: dispatches one report to the fixed Baci
 * support inbox through the shared Zeptomail sender (which records delivery
 * attempts with the admin client, like every platform email). Never throws;
 * resolves to whether the provider accepted the email.
 */
export async function sendFeedbackReportEmail(
  input: FeedbackReportEmailInput
): Promise<boolean> {
  try {
    const email = buildFeedbackReportEmail(input);
    const deadline = Date.now() + FEEDBACK_EMAIL_BUDGET_MS;
    const result = await sendEmail({
      to: FEEDBACK_INBOX_EMAIL,
      toName: 'Baci Support',
      subject: email.subject,
      htmlContent: email.htmlContent,
      textContent: email.textContent,
      replyTo: input.senderEmail ?? undefined,
      emailType: 'notifications',
      signal: AbortSignal.timeout(FEEDBACK_EMAIL_BUDGET_MS),
      maxAttemptsPerSender: 1,
      fallbackDeadlineMs: deadline,
      redactProviderErrorLog: true,
    });
    if (!result.success) {
      console.error('Feedback email not sent:', result.errorCode ?? 'unknown');
    }
    return result.success;
  } catch (error) {
    console.error(
      'Feedback email failed:',
      error instanceof Error ? error.name : 'unknown'
    );
    return false;
  }
}
