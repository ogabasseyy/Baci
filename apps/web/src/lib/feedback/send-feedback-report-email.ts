import {
  buildFeedbackReportEmail,
  FEEDBACK_INBOX_EMAIL,
  type FeedbackReportEmailInput,
} from '@/lib/feedback/feedback-report-email';
import { sendEmail } from '@/lib/zeptomail';

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
    const result = await sendEmail({
      to: FEEDBACK_INBOX_EMAIL,
      toName: 'Baci Support',
      subject: email.subject,
      htmlContent: email.htmlContent,
      textContent: email.textContent,
      replyTo: input.senderEmail ?? undefined,
      emailType: 'notifications',
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
