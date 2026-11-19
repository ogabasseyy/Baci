import {
  buildFeedbackReportEmail,
  FEEDBACK_INBOX_EMAIL,
  type FeedbackReportEmailInput,
} from '@/lib/feedback/feedback-report-email';
import { sendEmail } from '@/lib/zeptomail';
import { isValidEmail } from '@/lib/zeptomail-email-address';

// The admin app aborts API calls after 20s. One bounded attempt keeps a slow
// provider from turning an already-saved report into a client timeout (and a
// duplicate report when the merchant taps Send again).
export const FEEDBACK_EMAIL_BUDGET_MS = 10_000;

const TIMED_OUT = Symbol('feedback-email-timed-out');

// The provider signal only bounds the transport; the shared sender's audit
// writes run before and after it. This caps the whole step, so a stalled
// audit write cannot hold the response past the budget.
// A false result therefore means "not confirmed within the budget": a send
// that is still in flight may finish later and its audit row then records the
// real outcome. The report itself is already saved either way.
async function withinBudget<T>(
  work: Promise<T>
): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), FEEDBACK_EMAIL_BUDGET_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

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
    const result = await withinBudget(
      sendEmail({
        to: FEEDBACK_INBOX_EMAIL,
        toName: 'Baci Support',
        subject: email.subject,
        htmlContent: email.htmlContent,
        textContent: email.textContent,
        // An unusable sender address must not block the support email.
        replyTo:
          input.senderEmail && isValidEmail(input.senderEmail)
            ? input.senderEmail
            : undefined,
        emailType: 'notifications',
        signal: AbortSignal.timeout(FEEDBACK_EMAIL_BUDGET_MS),
        maxAttemptsPerSender: 1,
        fallbackDeadlineMs: deadline,
        redactProviderErrorLog: true,
      })
    );
    if (result === TIMED_OUT) {
      console.error('Feedback email not sent:', 'timeout');
      return false;
    }
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
