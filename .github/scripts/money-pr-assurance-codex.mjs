// Codex's verdict: a clean comment naming the head commit, posted after the
// latest money-rules request for that exact full commit, and not withdrawn
// or contradicted since.
import {
  authoredBy,
  byNewest,
  createdAt,
  latestRequest,
  postedAs,
  requestHint,
  shaMatchesHead,
  short,
  touchedAt,
  withdrawn,
  writtenAt,
} from './money-pr-assurance-authorship.mjs';

function reviewedCommit(body) {
  return /Reviewed commit:\**\s*`?([0-9a-f]{7,40})`?/i.exec(body)?.[1] ?? '';
}

// Codex keeps one review-summary comment per pull request and edits it with
// a machine-readable state after each review.
function summaryState(body) {
  const match = /<!--\s*codex-review-state:v1\s+(\{[\s\S]*?\})\s*-->/.exec(
    body
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]).code_review ?? null;
  } catch {
    return null;
  }
}

function isFullHead(sha, head) {
  return String(sha ?? '').toLowerCase() === head.toLowerCase();
}

// Anything touching Codex's record after its clean verdict that takes it
// back: a Codex item someone else edited or someone hid, a findings review
// on the head (dismissed or not), or a summary reporting unresolved
// findings on the head.
function contradiction(family, { comments, reviews, head }, clean) {
  const later = [...comments, ...reviews].filter(
    (item) => postedAs(item, family) && touchedAt(item) > clean.created
  );
  const tampered = later.find((item) => !authoredBy(item, family));
  if (tampered) {
    return `a later Codex comment was last edited by ${tampered.editor ?? 'an unknown login'}; ask Codex for a fresh review`;
  }
  if (later.some((item) => item.minimized === true))
    return 'a later Codex comment was hidden; ask Codex for a fresh review';
  const findings = later.some((item) => {
    if (item.commitId !== undefined) return isFullHead(item.commitId, head);
    const state = summaryState(item.body);
    return (
      state !== null &&
      isFullHead(state.commit_sha, head) &&
      state.has_unresolved_findings === true
    );
  });
  return findings
    ? `Codex raised findings on ${short(head)} after its clean verdict`
    : null;
}

export function evaluateCodex(family, input) {
  const { comments, head } = input;
  const request = latestRequest(family, input);
  if (!request) {
    return {
      state: 'missing',
      detail: `Codex was not asked for the money-rules review of ${short(head)}: ${requestHint(family, input)}`,
    };
  }
  const cleans = comments
    .filter((item) => authoredBy(item, family) && !withdrawn(item))
    .filter((item) =>
      family.cleanPhrases.some((phrase) => item.body.includes(phrase))
    )
    .map((item) => ({
      id: item.id,
      time: writtenAt(item),
      created: createdAt(item),
      sha: reviewedCommit(item.body),
    }))
    .sort(byNewest);
  // The newest clean verdict overall decides: an older clean for the head
  // does not count once a newer one names another commit, and it must come
  // after the latest request (both by last-edit time).
  const current = cleans[0];
  if (
    !current ||
    !shaMatchesHead(current.sha, head) ||
    current.time <= request.time
  ) {
    const why = !current
      ? 'no clean verdict found'
      : !shaMatchesHead(current.sha, head)
        ? `latest clean verdict was for ${short(current.sha)}`
        : 'it has not answered the latest money-rules request';
    return {
      state: 'missing',
      detail: `Codex has no clean verdict on ${short(head)} (${why})`,
    };
  }
  const contradicted = contradiction(family, input, current);
  if (contradicted) return { state: 'fail', detail: contradicted };
  return { state: 'pass', detail: `Codex clean verdict on ${short(head)}` };
}
