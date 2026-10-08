import type { createClient } from '@/lib/supabase/server';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type BlogPostMediaRow = {
  content?: string | null;
  excerpt?: string | null;
  featured_image_url?: string | null;
  featured_image_variants?: unknown;
  author_image_url?: string | null;
};

/**
 * Whether a persisted platform post embeds a storage path. Variant maps
 * serialize before matching; every other media-carrying column compares
 * directly, since stored URLs always contain the raw storage path.
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
    (field) => typeof field === 'string' && field.includes(path)
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
