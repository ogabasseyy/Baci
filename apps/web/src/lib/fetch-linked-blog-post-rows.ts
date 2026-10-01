import type { SupabaseClient } from '@supabase/supabase-js';

const LINKED_POST_PAGE_SIZE = 256;
// Keep the PostgREST `.in(...)` URL bounded; relationship reads still paginate.
const LINKED_PRODUCT_ID_CHUNK_SIZE = 100;

export interface LinkedBlogPostRow {
  blog_post_id?: string | null;
  id?: string | null;
  blog_posts?:
    | {
        published_at?: string | null;
        slug?: string | null;
        status?: string | null;
      }
    | Array<{
        published_at?: string | null;
        slug?: string | null;
        status?: string | null;
      }>
    | null;
}

/**
 * Read explicit product→article relationship rows in bounded id chunks with
 * per-chunk pagination. A failed page stops its chunk (later chunks still
 * run); the last error is returned alongside the preserved rows so the
 * caller can distinguish a partial result from a total lookup failure.
 */
export async function fetchLinkedBlogPostRows(
  supabase: SupabaseClient,
  merchantId: string,
  productIds: readonly string[]
) {
  const rows: LinkedBlogPostRow[] = [];
  let lastError: unknown = null;

  for (
    let chunkStart = 0;
    chunkStart < productIds.length;
    chunkStart += LINKED_PRODUCT_ID_CHUNK_SIZE
  ) {
    const productIdChunk = productIds.slice(
      chunkStart,
      chunkStart + LINKED_PRODUCT_ID_CHUNK_SIZE
    );
    for (let page = 0; ; page += 1) {
      let data: unknown;
      let error: unknown;
      try {
        ({ data, error } = await supabase
          .from('blog_post_products')
          .select(
            'id, blog_post_id, blog_posts!inner(slug, status, published_at)'
          )
          .eq('merchant_id', merchantId)
          .eq('blog_posts.status', 'published')
          .not('blog_posts.published_at', 'is', null)
          .in('product_id', productIdChunk)
          .order('blog_post_id', { ascending: true })
          .order('id', { ascending: true })
          .range(
            page * LINKED_POST_PAGE_SIZE,
            (page + 1) * LINKED_POST_PAGE_SIZE - 1
          ));
      } catch (pageError) {
        // A rejected page preserves the rows already fetched exactly like
        // an `{ error }` result; the caller escalates when nothing survived.
        lastError = pageError;
        break;
      }

      if (error) {
        lastError = error;
        break;
      }

      const pageRows = (data as unknown as LinkedBlogPostRow[]) ?? [];
      rows.push(...pageRows);

      if (pageRows.length < LINKED_POST_PAGE_SIZE) {
        break;
      }
    }
  }

  return { lastError, rows };
}
