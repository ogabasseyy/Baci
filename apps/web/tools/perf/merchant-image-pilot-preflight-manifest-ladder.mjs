// Ladder coverage + order for the manifest-contract mirror: tiers must
// cover the role ladder exactly once, in canonical order
// (requestedWidth ascending, avif before webp). The acceptance binds
// output hashes positionally, so a reordered ladder would let swapped
// tier claims certify against the wrong rung. Returns the issue list
// (empty = valid).
import { TIERS } from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import { isPlainObject } from './merchant-image-pilot-preflight-shared.mjs';

export function ladderCoverageIssues(tiers, role) {
  const issues = [];
  const expectedLadder = new Set();
  for (const width of TIERS[role] ?? []) {
    for (const format of ['avif', 'webp']) {
      expectedLadder.add(`${width}:${format}`);
    }
  }
  const seenLadder = new Set();
  let ladderOk = expectedLadder.size > 0;
  for (const tier of tiers) {
    // Non-object entries were already reported by the entry-shape loop;
    // mark the ladder invalid and stop so the check reports a contract
    // failure instead of throwing on the property reads below.
    if (!isPlainObject(tier)) {
      ladderOk = false;
      break;
    }
    const key = `${tier.requestedWidth}:${tier.format}`;
    if (!expectedLadder.has(key) || seenLadder.has(key)) {
      ladderOk = false;
      break;
    }
    seenLadder.add(key);
  }
  if (!ladderOk || seenLadder.size !== expectedLadder.size) {
    issues.push(`tiers do not cover the ${role} ladder exactly once`);
  }
  // Canonical order mirror: the acceptance binds hashes positionally, so
  // the mirror must reject reordered ladders exactly like the schemas do.
  const rank = (tier) =>
    tier.requestedWidth * 10 + (tier.format === 'avif' ? 0 : 1);
  for (let index = 1; index < tiers.length; index += 1) {
    if (
      isPlainObject(tiers[index]) &&
      isPlainObject(tiers[index - 1]) &&
      rank(tiers[index]) < rank(tiers[index - 1])
    ) {
      issues.push('tiers must list the role ladder in canonical order');
      break;
    }
  }
  return issues;
}
