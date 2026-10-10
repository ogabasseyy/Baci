import { extractManagedBlogStoragePath } from '@/lib/blog-managed-storage-paths';
import { decodeHtmlEntities } from './blog-media-html-entity-decode';
import { unescapeJsonStringEscapes } from './blog-media-json-string-unescape';
import type { BlogPostMediaRow } from './blog-media-reference-scan';

const URL_PATTERN = /https?:\/\/[^\s"'<>]+/g;
const TRAILING_PUNCTUATION_PATTERN = /[?!.,:;*_~]+$/;

function trimMarkdownDelimiters(url: string): string {
  // The URL pattern cannot see markdown structure, so a match may
  // swallow its closing delimiter (`![alt](url)` keeps the `)`) or
  // trailing prose punctuation (`see url.`). Trailing `)` is always
  // a delimiter here — parens cannot appear in managed keys at all —
  // then trailing punctuation goes. Managed keys end
  // alphanumerically (`token.ext`, `variant.webp`), so trimming can
  // only reveal a path, never corrupt one.
  return url.replace(/\)+$/, '').replace(TRAILING_PUNCTUATION_PATTERN, '');
}

export function blogPostMediaPaths(row: BlogPostMediaRow): string[] {
  const texts: unknown[] = [
    row.content,
    row.excerpt,
    row.featured_image_url,
    row.author_image_url,
  ];
  if (typeof row.featured_image_variants === 'string') {
    texts.push(row.featured_image_variants);
  } else if (row.featured_image_variants) {
    texts.push(JSON.stringify(row.featured_image_variants));
  }
  const paths = new Set<string>();
  for (const text of texts) {
    if (typeof text !== 'string') continue;
    // Entities decode before JSON and percent stages: an escaped
    // URL spells its scheme `https:\/\/` or its path with character
    // references, which the URL pattern would otherwise never match.
    const unescaped = unescapeJsonStringEscapes(decodeHtmlEntities(text));
    for (const url of unescaped.match(URL_PATTERN) ?? []) {
      const normalized = trimMarkdownDelimiters(url);
      const path = extractManagedBlogStoragePath(normalized, {
        kind: 'platform',
      });
      if (path !== null) paths.add(path);
    }
  }
  return [...paths];
}
