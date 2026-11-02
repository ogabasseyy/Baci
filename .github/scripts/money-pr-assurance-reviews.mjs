// Reads the adversarial reviewer verdicts, the owner's summary sign-off and
// review-thread state. Every verdict is bound to the current head SHA and to
// a trusted reviewer login; anything else is ignored. A comment or review
// last edited by anyone other than its author no longer counts as the
// author's: GitHub lets any writer edit other people's comments.

import {
  authoredBy,
  byNewest,
  postedAs,
  shaMatchesHead,
  short,
  writtenBy,
} from './money-pr-assurance-authorship.mjs';
import { evaluateCodex } from './money-pr-assurance-codex.mjs';

export { shaMatchesHead, writtenBy };

const DECORATION = '[\\s>*_`-]*';

function field(body, key) {
  const pattern = new RegExp(
    `^${DECORATION}${key}[*_\`]*\\s*:[*_\`\\s]*([^\\n]*?)[*_\`\\s]*$`,
    'gim'
  );
  return [...body.matchAll(pattern)].map((match) => match[1].trim());
}

// Returns null when the body has no verdict, { error } when it is malformed or
// ambiguous, and { verdict, head, prompt } otherwise.
export function parseVerdictBlock(body) {
  const text = String(body ?? '');
  const verdicts = field(text, 'MONEY-RULES-VERDICT');
  if (verdicts.length === 0) return null;
  const distinct = [...new Set(verdicts.map((value) => value.toUpperCase()))];
  if (distinct.length > 1)
    return { error: 'conflicting MONEY-RULES-VERDICT lines' };
  if (distinct[0] !== 'PASS' && distinct[0] !== 'FAIL') {
    return {
      error: `MONEY-RULES-VERDICT must be PASS or FAIL, not "${verdicts[0]}"`,
    };
  }
  const heads = [
    ...new Set(
      field(text, 'REVIEWED-HEAD').map((value) => value.toLowerCase())
    ),
  ];
  if (heads.length !== 1 || !/^[0-9a-f]{7,40}$/.test(heads[0])) {
    return { error: 'REVIEWED-HEAD must name exactly one commit SHA' };
  }
  const prompts = [...new Set(field(text, 'PROMPT-VERSION'))];
  if (prompts.length !== 1)
    return { error: 'PROMPT-VERSION must appear exactly once' };
  return { verdict: distinct[0], head: heads[0], prompt: prompts[0] };
}

function evaluateVerdictFamily(
  family,
  { comments, reviews, head, promptVersion }
) {
  // A marker proves nothing unless it opens the body: quoted or generated
  // text further down could carry it.
  const marker = family.requiredMarker?.replaceAll('{head}', head) ?? null;
  const posted = [
    ...comments.map((item) => ({
      ...item,
      time: item.updatedAt || item.createdAt,
      created: item.createdAt,
    })),
    ...reviews.map((item) => ({
      ...item,
      time: item.submittedAt,
      created: item.submittedAt,
    })),
  ].filter(
    (item) =>
      postedAs(item, family) &&
      (marker === null || item.body.trimStart().startsWith(marker))
  );
  const candidates = posted
    .filter((item) => authoredBy(item, family))
    .map((item) => ({ ...item, parsed: parseVerdictBlock(item.body) }))
    .filter(({ parsed }) => parsed !== null)
    .sort(byNewest);
  const current = candidates.find(
    ({ parsed }) =>
      parsed.error ||
      (shaMatchesHead(parsed.head, head) && parsed.prompt === promptVersion)
  );
  // Rewriting or blanking a newer verdict must not let an older one win.
  const tampered = posted.find(
    (item) =>
      !authoredBy(item, family) && item.created > (current?.created ?? '')
  );
  if (tampered) {
    return {
      state: 'fail',
      detail: `${family.name} has a comment last edited by ${tampered.editor ?? 'an unknown login'}; ask ${family.name} for a fresh review`,
    };
  }
  if (!current) {
    const stale = candidates[0]?.parsed;
    const why = stale
      ? stale.prompt !== promptVersion
        ? `latest verdict used prompt "${stale.prompt}", expected "${promptVersion}"`
        : `latest verdict was for ${short(stale.head)}`
      : 'no verdict found';
    return {
      state: 'missing',
      detail: `${family.name} has no money-rules verdict on ${short(head)} (${why})`,
    };
  }
  if (current.parsed.error)
    return {
      state: 'fail',
      detail: `${family.name} verdict is invalid: ${current.parsed.error}`,
    };
  if (current.parsed.verdict !== 'PASS') {
    return {
      state: 'fail',
      detail: `${family.name} money-rules verdict on ${short(head)} is FAIL`,
    };
  }
  return {
    state: 'pass',
    detail: `${family.name} money-rules verdict PASS on ${short(head)}`,
  };
}

export function evaluateReviewers({ comments, reviews, head, reviewers }) {
  const families = {};
  for (const family of Object.values(reviewers.families)) {
    const input = {
      comments,
      reviews,
      head,
      promptPath: reviewers.promptPath,
      promptVersion: reviewers.promptVersion,
    };
    families[family.name] =
      family.kind === 'codex-clean-comment'
        ? evaluateCodex(family, input)
        : evaluateVerdictFamily(family, input);
  }
  const failures = [];
  for (const group of reviewers.groups) {
    if (group.some((name) => families[name].state === 'pass')) continue;
    const details = group.map((name) => families[name].detail).join('; ');
    failures.push(
      `Needs a passing adversarial verdict from ${group.join(' or ')}: ${details}.`
    );
  }
  return { satisfied: failures.length === 0, failures, families };
}

// The owner may approve in a PR comment or a review body; either way the
// author must be the owner's user account, never a bot.
export function evaluateOwnerSignoff({
  comments,
  reviews = [],
  head,
  ownerSignoff,
}) {
  const escaped = ownerSignoff.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^\\s*${escaped}\\s+([0-9a-f]{7,40})\\s*$`, 'gim');
  const approvals = [...comments, ...reviews]
    .filter(
      (item) => writtenBy(item, ownerSignoff.logins) && item.userType === 'User'
    )
    .flatMap((item) =>
      [...item.body.matchAll(pattern)].map((match) => match[1])
    );
  if (approvals.some((sha) => shaMatchesHead(sha, head))) {
    return {
      approved: true,
      detail: `Owner approved the summary at ${short(head)}`,
    };
  }
  const stale =
    approvals.length > 0
      ? ` (latest approval named ${short(approvals[approvals.length - 1])})`
      : '';
  return {
    approved: false,
    detail: `Owner sign-off needed: the owner comments "${ownerSignoff.phrase} ${short(head)}"${stale}`,
  };
}

export function countUnresolvedThreads(threads) {
  return threads.filter((thread) => !thread.isResolved).length;
}
