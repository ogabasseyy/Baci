import { normalizeStorefrontCategoryValue } from '@/lib/normalize-storefront-category-value';

export interface BlogCategoryLookup {
  candidates: string[];
  canonicalFilter: string;
  /** Bounded `.or(...)` groups safe to send as separate PostgREST requests. */
  canonicalFilters: string[];
  canonicalSlugs: string[];
}

const MAX_CANONICAL_FILTER_LENGTH = 2500;
const CANONICAL_FILTER_PREFIX = 'category.ilike.*';
const CANONICAL_FILTER_SUFFIX = '*';
const MAX_CANONICAL_PATTERN_BODY_LENGTH =
  MAX_CANONICAL_FILTER_LENGTH -
  CANONICAL_FILTER_PREFIX.length -
  CANONICAL_FILTER_SUFFIX.length;

function chunkCanonicalFilters(patterns: readonly string[]) {
  const filters: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const pattern of patterns) {
    const nextLength =
      currentLength + pattern.length + (current.length > 0 ? 1 : 0);
    if (current.length > 0 && nextLength > MAX_CANONICAL_FILTER_LENGTH) {
      filters.push(current.join(','));
      current = [];
      currentLength = 0;
    }

    current.push(pattern);
    currentLength += pattern.length + (current.length > 1 ? 1 : 0);
  }

  if (current.length > 0) {
    filters.push(current.join(','));
  }

  return filters;
}

export function getBlogCategoryLookup(
  categorySlugs: readonly string[]
): BlogCategoryLookup {
  const candidates = new Set<string>();
  const canonicalSlugs = Array.from(
    new Set(
      categorySlugs
        .map((categorySlug) => normalizeStorefrontCategoryValue(categorySlug))
        .filter((categorySlug): categorySlug is string => Boolean(categorySlug))
    )
  );
  const patterns = new Set<string>();

  for (const value of categorySlugs) {
    const trimmed = value.trim();
    if (!trimmed) continue;

    const spaced = trimmed.replace(/[-_]+/gu, ' ');
    const titleCased = spaced.replace(
      /(^|\s)([a-z])/giu,
      (_match, prefix: string, character: string) =>
        `${prefix}${character.toUpperCase()}`
    );

    for (const candidate of [
      trimmed,
      trimmed.toLowerCase(),
      spaced,
      titleCased,
    ]) {
      if (candidate.length > 0) candidates.add(candidate);
    }
  }

  for (const canonicalSlug of canonicalSlugs) {
    const words = canonicalSlug.split('-').filter(Boolean);
    if (words.length === 0) continue;

    const addPattern = (parts: readonly string[]) => {
      const body = parts.join('*');
      // A single character-expanded word can exceed the PostgREST query
      // budget before `chunkCanonicalFilters` gets a chance to split it.
      // Keep a bounded prefix and let the canonical row check below reject
      // false positives; this preserves matching for ordinary labels while
      // preventing an oversized `.or(...)` value from dropping the purge.
      const boundedBody = body.slice(0, MAX_CANONICAL_PATTERN_BODY_LENGTH);
      if (boundedBody.length > 0) {
        patterns.add(
          `${CANONICAL_FILTER_PREFIX}${boundedBody}${CANONICAL_FILTER_SUFFIX}`
        );
      }
    };

    addPattern(words);
    // A category label may contain more than one punctuation boundary (for
    // example "Women's & Children's Fashion"). A wildcard between every
    // character keeps one bounded PostgREST pattern that can match those
    // separators; the caller still canonicalizes and verifies returned rows.
    addPattern(words.map((word) => word.split('').join('*')));
  }

  const canonicalFilters = chunkCanonicalFilters(Array.from(patterns));

  return {
    candidates: Array.from(candidates),
    canonicalFilter: canonicalFilters.join(','),
    canonicalFilters,
    canonicalSlugs,
  };
}
