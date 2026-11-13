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
 * Truncates already-sanitized feed text to maxLength grapheme clusters.
 * Grapheme (not UTF-16 unit or bare code point) truncation keeps surrogate
 * pairs, ZWJ sequences, and flags intact so no broken character is produced
 * at the cut boundary. Falls back to code points where Intl.Segmenter is
 * unavailable.
 */
const feedGraphemeSegmenter =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('en', { granularity: 'grapheme' })
    : null;

export function truncateFeedText(value: string, maxLength: number): string {
  const stripped = stripInvalidXml10Characters(value);
  // Iterate lazily: materializing every grapheme of a multi-megabyte post
  // before slicing costs hundreds of MB and seconds on cache misses.
  const units = feedGraphemeSegmenter
    ? feedGraphemeSegmenter.segment(stripped)
    : stripped;
  let result = '';
  let count = 0;
  for (const unit of units) {
    if (count >= maxLength) {
      break;
    }
    result += typeof unit === 'string' ? unit : unit.segment;
    count += 1;
  }
  return result;
}

/**
 * Makes a complete feed URL XML-safe while preserving its identity.
 * Percent-encoding (not deletion) keeps structural channel links
 * resolvable, and encodeURI output is XML-valid by construction. Existing
 * percent-encoded triplets pass through untouched so they are never
 * double-encoded. Lone surrogates cannot survive in XML output and make
 * encodeURI throw, so they are stripped via the fallback path only.
 * No-op for well-formed URLs.
 */
export function xmlSafeFeedUrl(url: string): string {
  try {
    return url
      .split(/(%[\dA-Fa-f]{2})/g)
      .map((part, index) => (index % 2 === 1 ? part : encodeURI(part)))
      .join('');
  } catch {
    return encodeURI(stripInvalidXml10Characters(url));
  }
}

/**
 * Percent-encodes one URL path segment (e.g. a post slug) for feed links.
 * Unlike full URLs, a bare `%` here is data and is correctly encoded to
 * `%25` so the emitted link still resolves to the exact record. Lone
 * surrogates would make encodeURIComponent throw, so they fall back to a
 * stripped encoding instead of failing the whole feed. No-op for clean
 * slugs.
 */
export function xmlSafeFeedPathSegment(segment: string): string {
  try {
    return encodeURIComponent(segment);
  } catch {
    return encodeURIComponent(stripInvalidXml10Characters(segment));
  }
}

/**
 * Returns an image/logo URL only when XML sanitization leaves it untouched.
 * A stripped URL identifies a different (likely broken) resource, so URLs
 * altered by XML stripping are omitted instead of silently rewritten. (URLs
 * already go through WHATWG parsing upstream, whose tab/LF/CR normalization
 * is identical in every browser and feed reader, so the emitted value always
 * matches what any consumer would fetch for the stored value.)
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

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

const CDN_FORMAT_TRANSFORM_REGEX =
  /(?:^|[/,;])(?:format|f)=([a-z0-9]+)(?=$|[/,;])/i;

/**
 * Derives an accurate IANA media type from an image URL for RSS enclosures.
 *
 * Honors CDN format transforms (e.g. `/cdn-cgi/image/format=webp/...jpg` or
 * `?format=avif`) before falling back to the pathname extension. Returns
 * `undefined` when the served media type is indeterminate (such as
 * `format=auto`, extension-less URLs, or unknown extensions) so callers do not
 * emit mismatched `<enclosure type="...">` attributes.
 */
export function getImageMimeType(url: string): string | undefined {
  try {
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname.toLowerCase();
    const queryFormat = (
      parsedUrl.searchParams.get('format') ??
      parsedUrl.searchParams.get('f') ??
      ''
    ).toLowerCase();
    const pathFormat = (
      pathname.match(CDN_FORMAT_TRANSFORM_REGEX)?.[1] ?? ''
    ).toLowerCase();
    if (pathFormat && queryFormat && pathFormat !== queryFormat) {
      return undefined;
    }
    const transformFormat = pathFormat || queryFormat;

    if (transformFormat) {
      if (transformFormat === 'auto') {
        return undefined;
      }
      return Object.hasOwn(MIME_BY_EXTENSION, transformFormat)
        ? MIME_BY_EXTENSION[transformFormat]
        : undefined;
    }

    const lastDotIndex = pathname.lastIndexOf('.');
    if (lastDotIndex === -1) {
      return undefined;
    }
    const ext = pathname.slice(lastDotIndex + 1);
    return Object.hasOwn(MIME_BY_EXTENSION, ext)
      ? MIME_BY_EXTENSION[ext]
      : undefined;
  } catch {
    return undefined;
  }
}
