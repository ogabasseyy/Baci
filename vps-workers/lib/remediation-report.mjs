import { redactCodexOutput } from './remediation-codex-output.mjs';

const DEFAULT_EMAIL_TIMEOUT_MS = 10_000;
const MAX_EMAIL_TIMEOUT_MS = 30_000;

function safe(value, length = 160) {
  return redactCodexOutput(String(value || '(unknown)'))
    .replace(/[\r\n<>]/g, ' ')
    .slice(0, length);
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' &&
      url.hostname &&
      !url.username &&
      !url.password
      ? `${url.origin}${url.pathname}`.slice(0, 500)
      : '';
  } catch {
    return '';
  }
}

function lifecycleLine(candidate) {
  const history = Array.isArray(candidate.history) ? candidate.history : [];
  const outcomes = history
    .slice(-5)
    .map((outcome) => safe(outcome?.type, 80))
    .filter(Boolean)
    .join(',');
  return [
    `case=${safe(candidate.caseId || candidate.caseKey || candidate.fingerprint, 300)}`,
    `category=${safe(candidate.category, 80)}`,
    `lifecycle=${safe(candidate.status || 'open', 40)}`,
    `recurrences=${Number(candidate.recurrenceCount) || 0}`,
    `observations=${Number(candidate.occurrences) || 0}`,
    `priorOutcomes=${outcomes || 'none'}`,
    `draftPr=${safeHttpsUrl(candidate.draftPr?.url) || 'none'}`,
  ].join(' | ');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function parseRecipients(value) {
  return String(value || '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);
}

function buildZeptoMailAuthorization(token) {
  const trimmedToken = String(token || '').trim();
  return trimmedToken.startsWith('Zoho-enczapikey ')
    ? trimmedToken
    : `Zoho-enczapikey ${trimmedToken}`;
}

export function buildRemediationReport({
  actions = [],
  candidates = [],
  mode = 'dry-run',
  policy = { allowed: false, reasons: [] },
  source = 'production-error-remediator',
} = {}) {
  const subject = `Baci ${safe(source, 80)} ${safe(mode, 40)}: ${candidates.length} candidate(s)`;
  const candidateLines = candidates.map(lifecycleLine);
  const actionLines = actions.map((action) => safe(action.type, 80));
  const policyLines = policy.allowed
    ? ['automated PR policy: allowed']
    : [
        'automated PR policy: blocked',
        ...policy.reasons.map((reason) => safe(reason, 240)),
      ];

  const text = [
    `Mode: ${safe(mode, 40)}`,
    '',
    'Candidates:',
    ...(candidateLines.length ? candidateLines : ['none']),
    '',
    'Actions:',
    ...(actionLines.length ? actionLines : ['none']),
    '',
    'Policy:',
    ...policyLines,
  ].join('\n');

  const html = `
    <h1>Baci ${escapeHtml(safe(source, 80))}</h1>
    <p><strong>Mode:</strong> ${escapeHtml(safe(mode, 40))}</p>
    <h2>Candidates</h2>
    <ul>${(candidateLines.length ? candidateLines : ['none'])
      .map((line) => `<li>${escapeHtml(line)}</li>`)
      .join('')}</ul>
    <h2>Actions</h2>
    <ul>${(actionLines.length ? actionLines : ['none'])
      .map((line) => `<li>${escapeHtml(line)}</li>`)
      .join('')}</ul>
    <h2>Policy</h2>
    <ul>${policyLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
  `;

  return { html, subject, text };
}

export async function sendRemediationReportEmail({
  env = process.env,
  fetchFn = fetch,
  report,
  timeoutMs = DEFAULT_EMAIL_TIMEOUT_MS,
}) {
  const recipients = parseRecipients(env.BACI_REMEDIATION_NOTIFY_EMAILS);
  const token = String(env.ZEPTOMAIL_TOKEN || '').trim();
  const fromDomain = env.ZEPTOMAIL_FROM_DOMAIN || 'usebaci.com';
  if (recipients.length === 0 || token.length === 0) {
    return { skipped: true, reason: 'email not configured' };
  }

  const requestTimeoutMs =
    Number.isSafeInteger(timeoutMs) && timeoutMs > 0
      ? Math.min(timeoutMs, MAX_EMAIL_TIMEOUT_MS)
      : DEFAULT_EMAIL_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response;
  try {
    response = await fetchFn('https://api.zeptomail.com/v1.1/email', {
      body: JSON.stringify({
        from: {
          address: `notifications@${fromDomain}`,
          name: 'Baci Ops',
        },
        htmlbody: report.html,
        subject: report.subject,
        textbody: report.text,
        to: recipients.map((address) => ({
          email_address: { address },
        })),
      }),
      headers: {
        Authorization: buildZeptoMailAuthorization(token),
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('ZeptoMail report request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  await response.body?.cancel().catch(() => undefined);
  if (!response.ok) {
    throw new Error(`ZeptoMail report failed with HTTP ${response.status}`);
  }

  return { skipped: false, recipients: recipients.length };
}
