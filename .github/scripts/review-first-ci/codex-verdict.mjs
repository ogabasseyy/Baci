// Decides what Codex has said about ONE pull-request head commit.
//
// Input is the evidence list from codex-evidence.mjs (oldest first). The answer is
// bound to the exact head commit:
//   * the newest decisive Codex item for the head wins (clean / findings / running);
//   * a verdict that names a different commit is reused only when carryOver(from, to)
//     proves the pull request's net diff did not change (the "sync merge from main"
//     case). Any doubt, error or missing proof means "no clean verdict".
//
// state: 'clean' | 'findings' | 'running' | 'none'

const MIN_ABBREVIATION = 7;
const DECISIVE = new Set(['clean', 'findings', 'running']);

export function shaMatches(candidate, head) {
  if (!candidate || !head) return false;
  const left = String(candidate).toLowerCase();
  const right = String(head).toLowerCase();
  if (left.length >= right.length) return left === right;
  return left.length >= MIN_ABBREVIATION && right.startsWith(left);
}

const short = (sha) => String(sha ?? '').slice(0, 7) || 'unknown';

function newest(items) {
  return items.reduce((best, current) => (!best || Date.parse(current.time) >= Date.parse(best.time) ? current : best), null);
}

const EXACT_REASON = {
  clean: (head) => `Codex reported no major issues for ${short(head)}`,
  findings: (head) => `Codex reported findings for ${short(head)}`,
  running: (head) => `Codex is still reviewing ${short(head)}`,
};

export async function evaluateVerdict({ evidence, headSha, resolveSha, carryOver }) {
  const forHead = evidence.filter((entry) => DECISIVE.has(entry.kind) && (entry.sha == null ? entry.kind === 'running' : shaMatches(entry.sha, headSha)));
  const exact = newest(forHead);
  if (exact) {
    return { state: exact.kind, carried: false, sha: headSha, reason: EXACT_REASON[exact.kind](headSha), evidence: exact };
  }

  const others = evidence.filter((entry) => (entry.kind === 'clean' || entry.kind === 'findings') && entry.sha && !shaMatches(entry.sha, headSha));
  const candidate = newest(others);
  if (!candidate) {
    const limited = evidence.some((entry) => entry.kind === 'unavailable');
    return {
      state: 'none',
      carried: false,
      sha: headSha,
      reason: limited ? 'Codex only reported a usage limit (no review of this commit)' : 'no Codex verdict found for this commit',
    };
  }

  const differs = `Codex's latest verdict is for a different commit (${short(candidate.sha)}) and the pull request's diff changed since`;
  let from = String(candidate.sha).toLowerCase();
  try {
    if (from.length < 40) from = await resolveSha(from);
    if (!from) return { state: 'none', carried: false, sha: headSha, reason: `${differs}; the abbreviated commit ${short(candidate.sha)} could not be resolved` };
    if (!(await carryOver(from, headSha))) return { state: 'none', carried: false, sha: headSha, reason: differs };
  } catch (error) {
    return { state: 'none', carried: false, sha: headSha, reason: `${differs}; could not prove the diff is unchanged (${error.message})` };
  }
  return {
    state: candidate.kind,
    carried: true,
    sha: headSha,
    reason: `Codex ${candidate.kind === 'clean' ? 'reported no major issues' : 'reported findings'} for ${short(from)}; the net diff of ${short(headSha)} is identical (every touched file has the same final content and the same hunks)`,
    evidence: candidate,
  };
}
