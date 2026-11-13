const BOT_USER_ID = 199175422;
const CODEX_APP_ID = 1144995;
const MARKER = 'codex-review-state:v1';
const MAX_BODY_LENGTH = 200_000;

export function isCodexAppComment(item) {
  return item?.user?.id === BOT_USER_ID && item.user.type === 'Bot' &&
    item?.performed_via_github_app?.id === CODEX_APP_ID;
}

// This is an advisory interpretation of the app's observed comment format,
// not a signed review API or a replacement for branch protection.
export function classifyCodexReview(comments, head) {
  if (!Array.isArray(comments) || !/^[0-9a-f]{40}$/.test(head)) {
    throw new Error('Expected comments and an immutable head SHA');
  }
  const summaries = comments.filter((item) =>
    isCodexAppComment(item) &&
    typeof item.body === 'string' && item.body.includes(MARKER)
  );
  if (!summaries.length) return 'pending';
  if (summaries.length !== 1) return 'ambiguous';
  const body = summaries[0].body;
  if (body.length > MAX_BODY_LENGTH) return 'unavailable';
  if (body.split(MARKER).length !== 2) return 'ambiguous';
  const matches = [...body.matchAll(/<!--\s*codex-review-state:v1\s+([\s\S]*?)\s*-->/g)];
  if (matches.length > 1) return 'ambiguous';
  if (matches.length !== 1) return 'unavailable';
  let review;
  try {
    const raw = matches[0][1].trim();
    const payload = JSON.parse(raw);
    // Reject duplicate keys and noncanonical representations instead of
    // silently accepting an ambiguous summary. Unexpected formats are unknown.
    if (JSON.stringify(payload) !== raw) return 'unavailable';
    review = payload?.code_review;
  } catch {
    return 'unavailable';
  }
  if (!review || typeof review !== 'object' || Array.isArray(review)) return 'unavailable';
  if (!/^[0-9a-f]{40}$/.test(review.commit_sha ?? '')) return 'unavailable';
  if (review.commit_sha !== head) return 'stale';
  if (['pending', 'queued', 'in_progress'].includes(review.status)) return 'pending';
  if (review.status !== 'completed' || typeof review.has_any_findings !== 'boolean' ||
      typeof review.has_unresolved_findings !== 'boolean' ||
      (!review.has_any_findings && review.has_unresolved_findings)) return 'unavailable';
  return review.has_unresolved_findings ? 'findings' : 'clean';
}
