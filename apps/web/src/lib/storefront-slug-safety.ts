/**
 * Deterministic safety gate for storefront product/category slug inputs.
 *
 * Bot and broken-link traffic produces repeatedly percent-encoded slugs
 * (`%2525252525…`) thousands of characters long. Real slugs are short
 * (`generateSlug` emits `[\w-]`, production maxes out near ~106 chars) and the
 * internal preflight routes already reject anything above 255 chars, so an
 * over-long or repeatedly-encoded slug can never resolve to a product. Judging
 * such input unsafe BEFORE it reaches internal preflight fetches or `'use
 * cache'`/Supabase lookups keeps unbounded attacker-controlled keys out of the
 * request/cache pipeline (the source of `UND_ERR_SOCKET` unhandled-rejection
 * crashes) without changing how normal valid or invalid slugs resolve.
 *
 * The gate only judges — it never rewrites the slug or throws on malformed
 * percent-encoding. Callers keep using their original value when it is safe.
 */

/** Mirrors the internal preflight route schema cap (`max(255)`). */
export const MAX_SAFE_STOREFRONT_SLUG_DECODED_LENGTH = 255;

/**
 * Upper bound on the raw (possibly still percent-encoded) input. Generous vs
 * the decoded cap so a legitimately encoded unicode slug is never rejected.
 */
export const MAX_SAFE_STOREFRONT_SLUG_ENCODED_LENGTH = 512;

/**
 * How many decode passes a legitimate value could ever need. Anything that
 * still decodes further after this budget carries the `%2525…` repeated
 * -encoding signature.
 */
export const MAX_SLUG_DECODE_PASSES = 3;

const PERCENT_ESCAPE_PATTERN = /%[0-9a-f]{2}/i;

export type StorefrontSlugSafetyReason =
  | 'empty'
  | 'too-long'
  | 'over-encoded'
  | 'decoded-too-long';

export type StorefrontSlugSafetyVerdict =
  | { safe: true }
  | { safe: false; reason: StorefrontSlugSafetyReason };

/**
 * One decode step. Returns null when the value cannot decode any further —
 * either it is already fully decoded (fixed point) or its percent-encoding is
 * malformed and `decodeURIComponent` would throw.
 */
function tryDecodeOnce(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return decoded === value ? null : decoded;
  } catch {
    return null;
  }
}

/**
 * Judges whether a storefront slug/category path value is safe to forward to
 * internal preflight fetches and cached product lookups.
 *
 * Deterministic and non-throwing by construction: malformed percent-encoding
 * simply stops the bounded decode loop and the value is judged as-is, so a
 * short-but-weird slug (`a%20b%`) stays safe and keeps its current behavior.
 */
export function evaluateStorefrontSlugSafety(
  slug: string | null | undefined
): StorefrontSlugSafetyVerdict {
  if (!slug) {
    return { safe: false, reason: 'empty' };
  }

  if (slug.length > MAX_SAFE_STOREFRONT_SLUG_ENCODED_LENGTH) {
    return { safe: false, reason: 'too-long' };
  }

  let current = slug;
  let passes = 0;
  while (
    passes < MAX_SLUG_DECODE_PASSES &&
    PERCENT_ESCAPE_PATTERN.test(current)
  ) {
    const decoded = tryDecodeOnce(current);
    if (decoded === null) {
      break;
    }
    current = decoded;
    passes += 1;
  }

  // Only a value that consumed the FULL decode budget and still decodes
  // further is the repeated-encoding signature; residual escapes after a
  // malformed/fixed-point stop are judged by length alone.
  if (passes === MAX_SLUG_DECODE_PASSES && tryDecodeOnce(current) !== null) {
    return { safe: false, reason: 'over-encoded' };
  }

  if (current.length > MAX_SAFE_STOREFRONT_SLUG_DECODED_LENGTH) {
    return { safe: false, reason: 'decoded-too-long' };
  }

  return { safe: true };
}

/**
 * Max blog search-query length forwarded to the cached listing lookup. Mirrors
 * the `searchQuery.trim().slice(0, 100)` inside `getCachedBlogListing`, so
 * clamping here bounds the `'use cache'` key WITHOUT changing results — the
 * downstream would ignore anything past this length anyway. Search text is
 * free-form (not a slug), so it is clamped rather than 404'd.
 */
export const MAX_BLOG_SEARCH_QUERY_LENGTH = 100;

/**
 * Bounds a blog `?search=` value before it becomes part of the cached listing
 * lookup's key. Returns undefined for empty/whitespace input.
 */
export function clampBlogSearchQuery(
  search: string | null | undefined
): string | undefined {
  const trimmed = search?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, MAX_BLOG_SEARCH_QUERY_LENGTH);
}
