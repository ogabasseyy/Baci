// Turns the model's JSON answer into a validated review, a status, and the text posted on the PR.
import { estimateCostUsd } from './pricing.mjs';
import { sanitizeText } from './sanitize.mjs';
import { BLOCKING_SEVERITIES, SEVERITIES } from './schema.mjs';

const MAX_FINDINGS = 20;
const MAX_NEXT_STEPS = 10;
const UNVERIFIED = '(path not in changed files — unverified)';

// Exact comparison apart from a leading "./": stripping a diff-style "a/" or "b/" prefix would make
// distinct repository paths such as `a/b` and `b` collide.
export function normalizePath(path) {
  return String(path ?? '')
    .trim()
    .replace(/^\.\//, '');
}

function cleanFinding(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const path = typeof raw.path === 'string' ? raw.path.trim() : '';
  const line = Number(raw.line);
  if (!title || !path || !Number.isInteger(line) || line < 0) return null;
  const severity = typeof raw.severity === 'string' ? raw.severity.toLowerCase() : '';
  return {
    severity: SEVERITIES.includes(severity) ? severity : 'low',
    title,
    path,
    line,
    body: typeof raw.body === 'string' ? raw.body.trim() : '',
  };
}

export function parseReview(text) {
  const unfenced = String(text ?? '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let data;
  try {
    data = JSON.parse(unfenced);
  } catch {
    return { ok: false, reason: 'not_json' };
  }
  if (!data || typeof data !== 'object' || typeof data.verdict !== 'string' || !data.verdict.trim() || !Array.isArray(data.findings)) {
    return { ok: false, reason: 'bad_shape' };
  }
  const findings = data.findings.map(cleanFinding).filter(Boolean);
  if (data.findings.length > 0 && findings.length === 0) return { ok: false, reason: 'malformed_findings' };
  findings.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
  const nextSteps = (Array.isArray(data.next_steps) ? data.next_steps : []).filter((step) => typeof step === 'string' && step.trim());
  return {
    ok: true,
    review: { verdict: data.verdict.trim(), findings: findings.slice(0, MAX_FINDINGS), next_steps: nextSteps.slice(0, MAX_NEXT_STEPS) },
  };
}

// With no changed-file list nothing can be verified, so nothing counts as a finding on the pull
// request (post.mjs abstains in that case instead of trusting every path).
const touches = (finding, changedFiles) => changedFiles.includes(normalizePath(finding.path));

/** failure only for a critical/high finding on a file this pull request changes. */
export function reviewState(review, changedFiles = []) {
  const files = changedFiles.map(normalizePath);
  return review.findings.some((f) => BLOCKING_SEVERITIES.includes(f.severity) && touches(f, files)) ? 'failure' : 'success';
}

const oneLine = (text, max) => sanitizeText(text, { max }).replace(/\s+/g, ' ').trim();

export function renderReview({ review, changedFiles = [] }) {
  const files = changedFiles.map(normalizePath);
  const lines = ['## Verdict', '', sanitizeText(review.verdict, { max: 800 }), '', '## Findings', ''];
  if (review.findings.length === 0) lines.push('- No meaningful issues found.');
  for (const finding of review.findings) {
    const where = `${oneLine(finding.path, 300)}${touches(finding, files) ? `:${finding.line}` : ''}`;
    lines.push(`- ${finding.severity}: ${oneLine(finding.title, 200)} in ${where}${touches(finding, files) ? '' : ` ${UNVERIFIED}`}`);
    const body = sanitizeText(finding.body, { max: 1500 });
    if (body) lines.push(...body.split('\n').map((line) => `  ${line}`));
  }
  lines.push('', '## Suggested next steps', '');
  if (review.next_steps.length === 0) lines.push('- None.');
  for (const step of review.next_steps) lines.push(`- ${oneLine(step, 300)}`);
  return lines.join('\n');
}

export function formatUsage(model, usage, dateIso) {
  const output = usage.outputTokens + usage.thoughtTokens;
  const cost = estimateCostUsd(model, usage, dateIso);
  const tokens = `${usage.promptTokens.toLocaleString('en-US')} in / ${output.toLocaleString('en-US')} out tokens`;
  return cost === null ? tokens : `${tokens}, about $${cost.toFixed(4)}`;
}

// The hidden first line of every posted review: the commit it covers, a fingerprint of what the
// pull request changes, and the resulting state. Later runs read it back to skip unchanged work.
const MARKER = /^<!-- gemini-code-review sha:([0-9a-f]{40}) fp:([0-9a-f]{64}|none) state:(success|failure) -->$/;

export function buildMarker({ sha, fingerprint, state }) {
  return `<!-- gemini-code-review sha:${sha} fp:${fingerprint || 'none'} state:${state} -->`;
}

export function parseMarker(body) {
  const first = String(body ?? '').split('\n', 1)[0].trim();
  const match = MARKER.exec(first);
  return match ? { sha: match[1], fp: match[2] === 'none' ? '' : match[2], state: match[3] } : null;
}
