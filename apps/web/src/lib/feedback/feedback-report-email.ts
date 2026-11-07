import { escapeHtmlText } from '@/lib/sanitize';

/** Baci's support inbox; every in-app feedback report is emailed here. */
export const FEEDBACK_INBOX_EMAIL = 'support@usebaci.com';

export interface FeedbackReportDetails {
  message: string;
  screen?: string;
  appVersion?: string;
  platform?: string;
  device?: string;
}

export interface FeedbackReportEmailInput {
  report: FeedbackReportDetails;
  feedbackId: string;
  businessName: string | null;
  merchantSlug: string | null;
  senderEmail: string | null;
  submittedAt: Date;
}

export interface FeedbackReportEmail {
  subject: string;
  htmlContent: string;
  textContent: string;
}

const SUBJECT_PREVIEW_LENGTH = 60;

function subjectPreview(message: string): string {
  const firstLine = message.split('\n')[0]?.trim() ?? '';
  return firstLine.length > SUBJECT_PREVIEW_LENGTH
    ? `${firstLine.slice(0, SUBJECT_PREVIEW_LENGTH - 1)}…`
    : firstLine;
}

function detailRows(input: FeedbackReportEmailInput): [string, string][] {
  const { report } = input;
  const store = input.merchantSlug
    ? `${input.businessName ?? 'Unnamed store'} (${input.merchantSlug})`
    : (input.businessName ?? 'Unnamed store');
  const rows: [string, string | null | undefined][] = [
    ['Store', store],
    ['Sent by', input.senderEmail],
    ['Screen', report.screen],
    ['Platform', report.platform],
    ['App version', report.appVersion],
    ['Device', report.device],
    ['Sent at', input.submittedAt.toISOString()],
    ['Report ID', input.feedbackId],
  ];
  return rows.filter((row): row is [string, string] => Boolean(row[1]));
}

/** Builds the support-inbox email for one in-app feedback report. */
export function buildFeedbackReportEmail(
  input: FeedbackReportEmailInput
): FeedbackReportEmail {
  const rows = detailRows(input);
  const storeName = input.businessName ?? 'a merchant';
  const subject = `Feedback from ${storeName}: ${subjectPreview(input.report.message)}`;

  const htmlRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#686878;white-space:nowrap;vertical-align:top;">${escapeHtmlText(label)}</td><td style="padding:6px 0;">${escapeHtmlText(value)}</td></tr>`
    )
    .join('');

  const htmlContent = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#1f1f29;max-width:600px;margin:0 auto;padding:20px;">
<h2 style="margin:0 0 16px;">New in-app feedback</h2>
<div style="white-space:pre-wrap;background:#f6f6f9;border-radius:8px;padding:16px;margin:0 0 20px;">${escapeHtmlText(input.report.message)}</div>
<table style="border-collapse:collapse;font-size:14px;">${htmlRows}</table>
${input.senderEmail ? '<p style="font-size:12px;color:#686878;margin-top:24px;">Reply to this email to answer the sender directly.</p>' : ''}
</body>
</html>`;

  const textContent = [
    'New in-app feedback',
    '',
    input.report.message,
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
  ].join('\n');

  return { subject, htmlContent, textContent };
}
