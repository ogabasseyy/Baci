import { stripInvalidXml10Characters } from './sanitize-xml-10';

interface BlogFeedFilterablePost {
  title: string;
  slug: string;
  category: string | null;
}

/**
 * Strips XML-forbidden characters from feed fields that double as
 * visibility-filter inputs. Judge fetched rows with the normalized copy
 * BEFORE filterPublicBlogPosts so the predicate evaluates the same text the
 * feed renders — otherwise a control character can split a blocked prefix
 * (e.g. `te<U+001A>st post`) or slug part and sneak test content past the
 * filter. Emission still uses the raw slug, percent-encoded per segment,
 * which preserves record identity and stays XML-safe.
 */
export function normalizeBlogFeedPostForFilter<
  T extends BlogFeedFilterablePost,
>(post: T): T {
  return {
    ...post,
    title: stripInvalidXml10Characters(post.title),
    slug: stripInvalidXml10Characters(post.slug),
    category:
      post.category === null
        ? null
        : stripInvalidXml10Characters(post.category),
  };
}

/**
 * Truncates already-sanitized feed text to maxLength code points. Code-point
 * (not UTF-16 unit) truncation keeps surrogate pairs intact so no lone
 * surrogate is produced at the cut boundary.
 */
export function truncateFeedText(value: string, maxLength: number): string {
  return Array.from(stripInvalidXml10Characters(value))
    .slice(0, maxLength)
    .join('');
}

/**
 * Makes a complete feed URL XML-safe while preserving its identity.
 * Percent-encoding (not deletion) keeps structural channel links
 * resolvable, and encodeURI output is XML-valid by construction. Lone
 * surrogates cannot survive in XML output and make encodeURI throw, so
 * they are stripped via the fallback path only. No-op for well-formed URLs.
 */
export function xmlSafeFeedUrl(url: string): string {
  try {
    return encodeURI(url);
  } catch {
    return encodeURI(stripInvalidXml10Characters(url));
  }
}

/**
 * Returns an image/logo URL only when XML sanitization leaves it untouched.
 * A stripped URL identifies a different (likely broken) resource, so altered
 * URLs are omitted instead of silently rewritten.
 */
export function xmlSafeFeedImageUrl(
  url: string | null | undefined
): string | undefined {
  if (!url) {
    return undefined;
  }
  const stripped = stripInvalidXml10Characters(url);
  return stripped === url ? stripped : undefined;
}
