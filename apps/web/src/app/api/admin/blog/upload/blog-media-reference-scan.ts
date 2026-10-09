import type { createClient } from '@/lib/supabase/server';
import { decodeHtmlEntities } from './blog-media-html-entity-decode';
import { unescapeJsonStringEscapes } from './blog-media-json-string-unescape';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type BlogPostMediaRow = {
  content?: string | null;
  excerpt?: string | null;
  featured_image_url?: string | null;
  featured_image_variants?: unknown;
  author_image_url?: string | null;
};

function decodeEscapeRuns(field: string): string {
  // Decode each maximal escape run independently: a stray %FF must
  // not hide a valid encoded reference elsewhere in the field.
  // Runs that still fail (split UTF8, lone invalid bytes) stay
  // literal, preserving the previous matching behavior there.
  return field.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

function decodeStoredMediaText(field: string): string {
  // Stored URLs may percent-encode path segments (%74oken) while the
  // candidate paths arrive decoded: compare against the decoded text
  // so an encoded reference still protects its object. HTML entities
  // decode first, then JSON string escapes, since persisted markup
  // and structured editor content serialize them and the storefront
  // renders through both. Decode to a bounded fixpoint for
  // multiply-encoded URLs; malformed escapes keep their own run raw
  // instead of throwing the scan out.
  let current = unescapeJsonStringEscapes(decodeHtmlEntities(field));
  for (let depth = 0; depth < 3; depth += 1) {
    if (!current.includes('%')) return current;
    const decoded = decodeEscapeRuns(current);
    if (decoded === current) return current;
    current = decoded;
  }
  return current;
}

/**
 * Whether a persisted platform post embeds a storage path. Variant maps
 * serialize before matching; every media-carrying column compares
 * percent-decoded, since stored URLs may encode the raw storage path.
 */
function blogPostRowReferencesPath(
  row: BlogPostMediaRow,
  path: string
): boolean {
  const fields: unknown[] = [
    row.content,
    row.excerpt,
    row.featured_image_url,
    row.author_image_url,
  ];
  if (typeof row.featured_image_variants === 'string') {
    fields.push(row.featured_image_variants);
  } else if (row.featured_image_variants) {
    fields.push(JSON.stringify(row.featured_image_variants));
  }
  return fields.some(
    (field) =>
      typeof field === 'string' && decodeStoredMediaText(field).includes(path)
  );
}

const BLOG_MEDIA_REFERENCE_SCAN_PAGE_SIZE = 1000;

/**
 * Split candidate delete paths by persisted references. A session that
 * abandons an upload cannot know another tab already saved its URL, so
 * deletion stays conditional on no persisted post referencing each
 * path. Merchant article content accepts sanitized HTTPS images, so a
 * merchant post can embed a public platform URL: the scan covers every
 * persisted row unfiltered. The scan pages through every matching row
 * in id order — range windows without a stable order could skip or
 * repeat rows — and stops early once every candidate is
 * known-referenced. Returns null when the reference scan itself fails
 * so the route fails closed instead of deleting blind.
 */
export async function filterBlogMediaPathsWithoutPersistedReferences(
  supabase: ServerSupabaseClient,
  paths: string[]
): Promise<{ deletable: string[]; skipped: string[] } | null> {
  if (paths.length === 0) return { deletable: [], skipped: [] };
  const referenced = new Set<string>();
  let offset = 0;
  try {
    for (;;) {
      const page = await supabase
        .from('blog_posts')
        .select(
          'content, excerpt, featured_image_url, featured_image_variants, author_image_url'
        )
        .order('id')
        .range(offset, offset + BLOG_MEDIA_REFERENCE_SCAN_PAGE_SIZE - 1);
      if (page.error) return null;
      const rows = (page.data ?? []) as BlogPostMediaRow[];
      for (const row of rows) {
        for (const path of paths) {
          if (!referenced.has(path) && blogPostRowReferencesPath(row, path)) {
            referenced.add(path);
          }
        }
      }
      if (
        rows.length < BLOG_MEDIA_REFERENCE_SCAN_PAGE_SIZE ||
        referenced.size === paths.length
      ) {
        break;
      }
      offset += BLOG_MEDIA_REFERENCE_SCAN_PAGE_SIZE;
    }
  } catch {
    return null;
  }
  return {
    deletable: paths.filter((path) => !referenced.has(path)),
    skipped: paths.filter((path) => referenced.has(path)),
  };
}
