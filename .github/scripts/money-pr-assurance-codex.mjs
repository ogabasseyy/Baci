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
      item.createdAt < clean.time
  );
}

export function evaluateCodex(family, input) {
  const { comments, reviews, head } = input;
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
  const laterFindings = reviews.filter(
    (item) =>
      postedAs(item, family) &&
      shaMatchesHead(item.commitId, head) &&
      item.submittedAt > current.time
  );
  if (laterFindings.length > 0) {
    return {
      state: 'fail',
      detail: `Codex raised findings on ${short(head)} after its clean verdict`,
    };
  }
  return { state: 'pass', detail: `Codex clean verdict on ${short(head)}` };
}
