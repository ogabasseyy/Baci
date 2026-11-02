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
    (item) => postedAs(item, family) && touchedAt(item) > clean.time
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
      time: createdAt(item),
      sha: reviewedCommit(item.body),
    }))
    .sort(byNewest);
  const onHead = cleans.filter(({ sha }) => shaMatchesHead(sha, head));
  // The request names the full commit, so a clean comment that answers it
  // is bound to that exact commit, not just to its short prefix.
  const current = onHead.find(({ time }) => time > request.time);
  if (!current) {
    const latestSha = cleans[0]?.sha;
    const why =
      onHead.length > 0
        ? 'it has not answered the latest money-rules request'
        : latestSha
          ? `latest clean verdict was for ${short(latestSha)}`
          : 'no clean verdict found';
    return {
      state: 'missing',
      detail: `Codex has no clean verdict on ${short(head)} (${why})`,
    };
  }
  const contradicted = contradiction(family, input, current);
  if (contradicted) return { state: 'fail', detail: contradicted };
  return { state: 'pass', detail: `Codex clean verdict on ${short(head)}` };
}
