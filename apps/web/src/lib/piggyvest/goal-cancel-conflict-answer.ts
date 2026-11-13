/**
 * A settlement answer 'conflict:<forfeit id>[,<forfeit id>]' is a conflict
 * whose review is (also) on other rows: a forfeit replacement that went to
 * review as its own row, or replacements a late success froze. Those rows are
 * acknowledged with the page, so the sweep does not page the same incident
 * again. Any other answer passes through unchanged.
 */
export function readConflictAnswer(result: unknown): {
  result: unknown;
  reviewedIds: readonly string[];
} {
  const named =
    typeof result === 'string'
      ? /^conflict:([0-9a-f-]{36}(?:,[0-9a-f-]{36}){0,9})$/.exec(result)
      : null;
  if (!named) return { result, reviewedIds: [] };
  return { result: 'conflict', reviewedIds: named[1].split(',') };
}
