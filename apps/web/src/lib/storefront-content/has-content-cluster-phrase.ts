import { normalizeClusterText } from './normalize-cluster-text';

const isPhraseBoundary = (v?: string): boolean => !v || /[^a-z0-9]/.test(v);

export function hasPhrase(haystack: string, needle: string) {
  const norm = normalizeClusterText(needle);
  if (norm.length === 0) return false;
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(norm, from);
    if (idx === -1) return false;
    if (
      isPhraseBoundary(haystack[idx - 1]) &&
      isPhraseBoundary(haystack[idx + norm.length])
    ) {
      return true;
    }
    from = idx + 1;
  }
}
