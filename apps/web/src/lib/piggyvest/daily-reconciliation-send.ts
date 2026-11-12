import 'server-only';
import { escapeHtmlText } from '@/lib/sanitize';
import { piggyvestDailyReconciliationSchemas as schemas } from '@/schemas/piggyvest-daily-reconciliation';

interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** Appends report lines (already plain text) to a rendered report email. */
export function withEmailLines(email: RenderedEmail, lines: readonly string[]) {
  if (lines.length === 0) return email;
  return {
    subject: email.subject,
    text: [email.text, '', ...lines].join('\n'),
    html: `${email.html}${lines
      .map((line) => `<p>${escapeHtmlText(line)}</p>`)
      .join('')}`,
  };
}

/**
 * Sends the owner report to the configured address. False (never a throw)
 * when there is no valid address or sending fails, so the run pages instead.
 */
export async function deliverReconciliationEmail(input: {
  address: string | undefined;
  email: RenderedEmail;
  sendEmail: (message: {
    to: string;
    subject: string;
    textContent: string;
    htmlContent: string;
  }) => Promise<{ success: boolean }>;
}): Promise<boolean> {
  const address = schemas.reportEmail.safeParse(input.address);
  if (!address.success) return false;
  try {
    return (
      (
        await input.sendEmail({
          to: address.data,
          subject: input.email.subject,
          textContent: input.email.text,
          htmlContent: input.email.html,
        })
      ).success === true
    );
  } catch {
    return false;
  }
}
