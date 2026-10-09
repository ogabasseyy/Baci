import { extractManagedBlogStoragePath } from '@/lib/blog-managed-storage-paths';
import type { createClient } from '@/lib/supabase/server';
import { unescapeJsonStringEscapes } from './blog-media-json-string-unescape';
import type { BlogPostMediaRow } from './blog-media-reference-scan';
import { BLOG_MEDIA_TOMBSTONE_TABLE } from './blog-media-tombstone-constants';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

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
    // JSON slash escapes unescape before matching: an escaped URL
    // spells its scheme `https:\/\/`, which the URL pattern would
    // otherwise never match at all.
    const unescaped = unescapeJsonStringEscapes(text);
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

/**
 * Resurrect tombstones a saved payload references. Only unclaimed rows
 * clear: a claimed row means the sweep already decided to remove the
 * object, and deleting the flag would blind the save's verification
 * instead of stopping the removal. Clearing is best-effort: the save
 * already committed, and any tombstone missed here is rechecked
 * against persisted references at sweep time, so a transient failure
 * delays cleanup instead of breaking media.
 */
export async function clearBlogMediaTombstonesForRow(
  supabase: ServerSupabaseClient,
  row: BlogPostMediaRow
): Promise<void> {
  const paths = blogPostMediaPaths(row);
  if (paths.length === 0) return;
  try {
    const { error } = await supabase
      .from(BLOG_MEDIA_TOMBSTONE_TABLE)
      .delete()
      .in('path', paths)
      .eq('claimed', false);
    if (error) {
      console.error('Failed to clear blog media tombstones', { error, paths });
    }
  } catch (error) {
    console.error('Failed to clear blog media tombstones', { error, paths });
  }
}
