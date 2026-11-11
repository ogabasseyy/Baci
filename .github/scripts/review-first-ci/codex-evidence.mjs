// Turns the GitHub objects Codex leaves on a pull request into small "evidence"
// records: { kind, sha, time, source, id }.
//
//   kind  'clean' | 'findings' | 'running' | 'unavailable'
//   sha   full 40-character commit, an abbreviation (Codex receipts print 10
//         characters) or null when Codex did not say which commit
//
// Formats seen on 2026-11-11 (they have changed before, so anything we do not
// recognise is reported in `unrecognized` and never counts as clean):
//   * issue comment  <!-- codex-pull-request-review-summary -->  with a hidden
//     <!-- codex-review-state:v1 {...} --> JSON, edited in place after every review
//   * issue comment  <!-- codex-review-receipt:v1 -->  "Didn't find any major issues."
//     "**Reviewed commit:** `<sha>`"  (clean verdict)
//   * review         <!-- codex-review-receipt:v1 -->  "automated review suggestions"
//   * inline comment ... <!-- codex-code-review-finding:v1 -->  with a P1/P2 badge
// Only items authored by the Codex connector bot are read; a human typing the same
// words never counts.

export const CODEX_LOGIN = 'chatgpt-codex-connector[bot]';

const CLEAN_PHRASE = /Didn['’]t find any major issues/i;
const REVIEWED_COMMIT = /Reviewed commit:\**\s*`?([0-9a-f]{7,40})`?/i;
const STATE_MARKER = /<!--\s*codex-review-state:v(\d+)\s+(\{[\s\S]*?\})\s*-->/i;
const STATE_ANY_VERSION = /<!--\s*codex-review-state:v(\d+)/i;
const RECEIPT_MARKER = /<!--\s*codex-review-receipt:v(\d+)\s*-->/i;
const FINDING_MARKER = /<!--\s*codex-code-review-finding:v(\d+)\s*-->/i;
const BADGE = /!\[P\d Badge\]/i;
const USAGE_LIMIT = /(reached your Codex usage limits|Codex usage limits have been reached)/i;
const FULL_SHA = /^[0-9a-f]{40}$/i;

const KNOWN_VERSION = '1';

export function isCodexAuthor(user) {
  return Boolean(user) && user.login === CODEX_LOGIN && (user.type === undefined || user.type === 'Bot');
}

const none = () => ({ evidence: [], unrecognized: [] });

function versionProblem(body) {
  const found = [];
  for (const [name, pattern] of [
    ['codex-review-state', STATE_ANY_VERSION],
    ['codex-review-receipt', RECEIPT_MARKER],
    ['codex-code-review-finding', FINDING_MARKER],
  ]) {
    const match = pattern.exec(body);
    if (match && match[1] !== KNOWN_VERSION) found.push(`${name}:v${match[1]}`);
  }
  return found;
}

function fromState(item, body) {
  const marker = STATE_MARKER.exec(body);
  if (!marker) return null;
  if (marker[1] !== KNOWN_VERSION) return null;
  let parsed;
  try {
    parsed = JSON.parse(marker[2]);
  } catch {
    return { evidence: [], unrecognized: [`comment ${item.id}: codex-review-state JSON could not be parsed`] };
  }
  const review = parsed?.code_review;
  if (!review || typeof review !== 'object' || review.status == null) return none();
  const time = item.updated_at ?? item.created_at;
  const base = { time, source: 'summary', id: item.id };
  if (review.status === 'running') {
    return { evidence: [{ ...base, kind: 'running', sha: typeof review.commit_sha === 'string' ? review.commit_sha : null }], unrecognized: [] };
  }
  if (review.status !== 'completed') {
    return { evidence: [], unrecognized: [`comment ${item.id}: unknown code_review status "${review.status}"`] };
  }
  if (review.has_unresolved_findings === true || review.has_any_findings === true) {
    return { evidence: [{ ...base, kind: 'findings', sha: typeof review.commit_sha === 'string' ? review.commit_sha : null }], unrecognized: [] };
  }
  if (review.has_any_findings === false && review.has_unresolved_findings === false) {
    if (typeof review.commit_sha === 'string' && FULL_SHA.test(review.commit_sha)) {
      return { evidence: [{ ...base, kind: 'clean', sha: review.commit_sha.toLowerCase() }], unrecognized: [] };
    }
    return { evidence: [], unrecognized: [`comment ${item.id}: clean state without a full commit sha`] };
  }
  return { evidence: [], unrecognized: [`comment ${item.id}: completed review with unreadable findings flags`] };
}

function fromCleanPhrase(item, body, time, source) {
  const sha = REVIEWED_COMMIT.exec(body)?.[1];
  if (!sha) return { evidence: [], unrecognized: [`${source} ${item.id}: clean verdict without a reviewed commit`] };
  return { evidence: [{ kind: 'clean', sha: sha.toLowerCase(), time, source: 'receipt', id: item.id }], unrecognized: [] };
}

export function evidenceFromIssueComment(item) {
  if (!item || !isCodexAuthor(item.user)) return none();
  const body = String(item.body ?? '');
  const problems = versionProblem(body);
  if (problems.length > 0) {
    return { evidence: [], unrecognized: problems.map((name) => `comment ${item.id}: ${name} is not understood`) };
  }
  const state = fromState(item, body);
  if (state) return state;
  if (CLEAN_PHRASE.test(body)) return fromCleanPhrase(item, body, item.created_at, 'comment');
  if (USAGE_LIMIT.test(body)) {
    return { evidence: [{ kind: 'unavailable', sha: null, time: item.created_at, source: 'notice', id: item.id }], unrecognized: [] };
  }
  return none();
}

export function evidenceFromReview(review) {
  if (!review || !isCodexAuthor(review.user)) return none();
  const body = String(review.body ?? '');
  if (body.trim() === '') return none();
  const problems = versionProblem(body);
  if (problems.length > 0) {
    return { evidence: [], unrecognized: problems.map((name) => `review ${review.id}: ${name} is not understood`) };
  }
  const time = review.submitted_at ?? review.created_at;
  if (CLEAN_PHRASE.test(body)) return fromCleanPhrase(review, body, time, 'review');
  const sha = REVIEWED_COMMIT.exec(body)?.[1] ?? review.commit_id ?? null;
  if (RECEIPT_MARKER.test(body) || BADGE.test(body)) {
    return { evidence: [{ kind: 'findings', sha: sha ? sha.toLowerCase() : null, time, source: 'review', id: review.id }], unrecognized: [] };
  }
  return none();
}

export function evidenceFromReviewComment(comment) {
  if (!comment || !isCodexAuthor(comment.user) || comment.in_reply_to_id) return none();
  const body = String(comment.body ?? '');
  const problems = versionProblem(body);
  if (problems.length > 0) {
    return { evidence: [], unrecognized: problems.map((name) => `inline comment ${comment.id}: ${name} is not understood`) };
  }
  if (!FINDING_MARKER.test(body) && !BADGE.test(body)) return none();
  const sha = comment.original_commit_id ?? comment.commit_id ?? null;
  return {
    evidence: [{ kind: 'findings', sha: sha ? sha.toLowerCase() : null, time: comment.created_at, source: 'inline', id: comment.id }],
    unrecognized: [],
  };
}

export function collectEvidence({ issueComments = [], reviews = [], reviewComments = [] }) {
  const parts = [
    ...issueComments.map(evidenceFromIssueComment),
    ...reviews.map(evidenceFromReview),
    ...reviewComments.map(evidenceFromReviewComment),
  ];
  const evidence = parts.flatMap((part) => part.evidence).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  return { evidence, unrecognized: parts.flatMap((part) => part.unrecognized) };
}
