export interface BlogPostKeywordSource {
  focus_keyword?: string | null;
  keywords?: string[] | null;
}

/**
 * Merges `focus_keyword` (populated by VPS content agents) and `keywords[]`
 * into a deduplicated, trimmed list of SEO keywords for metadata, JSON-LD,
 * cluster inference, and semantic related-post ranking.
 */
export function resolveBlogPostKeywords(
  post: BlogPostKeywordSource
): string[] | undefined {
  const seen = new Set<string>();
  const resolved: string[] = [];

  const candidates = [
    ...(typeof post.focus_keyword === 'string' ? [post.focus_keyword] : []),
    ...(Array.isArray(post.keywords) ? post.keywords : []),
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue;
    }
    const trimmed = candidate.trim();
    if (!trimmed) {
      continue;
    }
    const normalizedKey = trimmed.toLowerCase();
    if (seen.has(normalizedKey)) {
      continue;
    }
    seen.add(normalizedKey);
    resolved.push(trimmed);
  }

  return resolved.length > 0 ? resolved : undefined;
}
