// Codex's verdict: a clean comment naming the head commit, requested with
// the money-rules prompt, and not followed by findings on that commit.
import {
  authoredBy,
  byNewest,
  postedAs,
  shaMatchesHead,
  short,
  writtenBy,
} from './money-pr-assurance-authorship.mjs';

function reviewedCommit(body) {
  return /Reviewed commit:\**\s*`?([0-9a-f]{7,40})`?/i.exec(body)?.[1] ?? '';
}

// The newest Codex comment or review about an earlier head, before `before`.
function lastEarlierHeadActivity(family, { comments, reviews, head }, before) {
  return [
    ...comments
      .filter((item) => postedAs(item, family))
      .map((item) => ({
        time: item.createdAt,
        sha: reviewedCommit(item.body),
      })),
    ...reviews
      .filter((item) => postedAs(item, family))
      .map((item) => ({ time: item.submittedAt, sha: item.commitId })),
  ]
    .filter(
      ({ sha, time }) => sha && !shaMatchesHead(sha, head) && time < before
    )
    .reduce((latest, { time }) => (time > latest ? time : latest), '');
}

// Codex reviews every push on its own, with its general rules. Its clean
// verdict counts only after a trusted login asked it to follow the
// money-rules prompt, since its last word on an earlier head.
function wasRequested(family, input, clean) {
  const since = lastEarlierHeadActivity(family, input, clean.time);
  const phrase = family.requestPhrase.toLowerCase();
  return input.comments.some(
    (item) =>
      writtenBy(item, family.requestedBy) &&
      item.userType === 'User' &&
      item.body.toLowerCase().includes(phrase) &&
      item.body.includes(input.promptPath) &&
      item.createdAt > since &&
      // Its last edit too: adding the request to an old comment afterwards
      // must not certify a review that never saw it.
      (item.updatedAt || item.createdAt) < clean.time
  );
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

// Anything Codex said after its clean verdict that takes it back: a findings
// review on the head, a summary reporting unresolved findings on the head,
// or any later Codex item that someone else edited.
function withdrawal(family, { comments, reviews, head }, clean) {
  const later = [
    ...comments
      .filter((item) => postedAs(item, family))
      .map((item) => ({ item, time: item.updatedAt || item.createdAt })),
    ...reviews
      .filter((item) => postedAs(item, family))
      .map((item) => ({ item, time: item.submittedAt })),
  ].filter(({ time }) => time > clean.time);
  const tampered = later.find(({ item }) => !authoredBy(item, family));
  if (tampered) {
    return `a later Codex comment was last edited by ${tampered.item.editor ?? 'an unknown login'}; ask Codex for a fresh review`;
  }
  const findings = later.some(({ item }) => {
    if (item.commitId !== undefined) return shaMatchesHead(item.commitId, head);
    const state = summaryState(item.body);
    return (
      state !== null &&
      shaMatchesHead(state.commit_sha, head) &&
      state.has_unresolved_findings === true
    );
  });
  return findings
    ? `Codex raised findings on ${short(head)} after its clean verdict`
    : null;
}

export function evaluateCodex(family, input) {
  const { comments, head } = input;
  const cleans = comments
    .filter((item) => authoredBy(item, family))
    .filter((item) =>
      family.cleanPhrases.some((phrase) => item.body.includes(phrase))
    )
    .map((item) => ({
      id: item.id,
      time: item.createdAt,
      sha: reviewedCommit(item.body),
    }))
    .sort(byNewest);
  const current = cleans.find(({ sha }) => shaMatchesHead(sha, head));
  if (!current) {
    const latest = cleans[0]?.sha;
    return {
      state: 'missing',
      detail: latest
        ? `Codex has no clean verdict on ${short(head)} (latest clean verdict was for ${short(latest)})`
        : `Codex has no clean verdict on ${short(head)}`,
    };
  }
  if (!wasRequested(family, input, current)) {
    return {
      state: 'missing',
      detail: `Codex's clean verdict on ${short(head)} was not requested with the money-rules prompt (comment "${family.requestPhrase} Follow the main branch's ${input.promptPath}")`,
    };
  }
  const withdrawn = withdrawal(family, input, current);
  if (withdrawn) return { state: 'fail', detail: withdrawn };
  return { state: 'pass', detail: `Codex clean verdict on ${short(head)}` };
}
