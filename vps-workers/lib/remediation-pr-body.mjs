import { redactCodexOutput } from './remediation-codex-output.mjs';

export function buildRemediationPrBody(candidate) {
  const safe = (value, length = 160) =>
    redactCodexOutput(String(value || '(unknown)'))
      .replace(/[\r\n<>]/g, ' ')
      .slice(0, length);
  const outcomes = Array.isArray(candidate.history)
    ? candidate.history.slice(-5)
    : [];
  const draftPrUrl = (() => {
    try {
      const url = new URL(String(candidate.draftPr?.url || '').trim());
      return url.protocol === 'https:' &&
        url.hostname &&
        !url.username &&
        !url.password
        ? `${url.origin}${url.pathname}`.slice(0, 500)
        : '';
    } catch {
      return '';
    }
  })();
  const outcomeLines = outcomes.map(
    (outcome) => `- ${safe(outcome?.type, 80)} at ${safe(outcome?.at, 80)}`
  );
  return [
    'Automated draft PR from the Baci production error remediator.',
    '',
    `Case: ${safe(candidate.caseId || candidate.caseKey || candidate.fingerprint, 300)}`,
    `Category: ${safe(candidate.category, 80)}`,
    `Lifecycle status: ${safe(candidate.status || 'open', 40)}`,
    `Recurrences: ${Number(candidate.recurrenceCount) || 0}`,
    `Observations: ${Number(candidate.occurrences) || 0}`,
    `Draft PR: ${safe(draftPrUrl || 'none', 500)}`,
    'Prior outcomes:',
    ...(outcomeLines.length ? outcomeLines : ['- none']),
    '',
    'The worker is policy-gated. Protected files require human handling.',
  ].join('\n');
}
