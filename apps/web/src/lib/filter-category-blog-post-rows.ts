import type { SupabaseClient } from '@supabase/supabase-js';

const POST_ID_CHUNK_SIZE = 100;
const LINK_PAGE_SIZE = 256;

interface CategoryBlogPostRow {
  id?: string | null;
}

interface ActiveProductLinkRow {
  blog_post_id?: string | null;
  product?:
    | { status?: string | null }
    | Array<{ status?: string | null }>
    | null;
}

function hasActiveProduct(row: ActiveProductLinkRow) {
  const product = Array.isArray(row.product)
    ? (row.product[0] ?? null)
    : row.product;
  return product?.status === 'active';
}

async function getActiveLinkedPostIds(
  supabase: SupabaseClient,
  merchantId: string,
  postIds: readonly string[]
): Promise<Set<string> | null> {
  const activePostIds = new Set<string>();

  for (
    let chunkStart = 0;
    chunkStart < postIds.length;
    chunkStart += POST_ID_CHUNK_SIZE
  ) {
    const postIdChunk = postIds.slice(
      chunkStart,
      chunkStart + POST_ID_CHUNK_SIZE
    );
    for (let page = 0; ; page += 1) {
      const { data, error } = await supabase
        .from('blog_post_products')
        .select(
          'blog_post_id, product:products!blog_post_products_product_id_fkey!inner(status)'
        )
        .eq('merchant_id', merchantId)
        .eq('product.status', 'active')
        .in('blog_post_id', postIdChunk)
        .order('blog_post_id', { ascending: true })
        .range(page * LINK_PAGE_SIZE, (page + 1) * LINK_PAGE_SIZE - 1);

      if (error) {
        return null;
      }

      const pageRows = (data as unknown as ActiveProductLinkRow[]) ?? [];
      for (const row of pageRows) {
        const postId = row.blog_post_id?.trim();
        if (postId && hasActiveProduct(row)) {
          activePostIds.add(postId);
        }
      }

      if (pageRows.length < LINK_PAGE_SIZE) {
        break;
      }
    }
  }

  return activePostIds;
}

/**
 * Category fallback rails are used only when a published post has no active
 * explicit product links. Exclude those posts so a product mutation does not
 * purge unrelated category posts whose rail is already link-driven.
 *
 * Reads are best-effort: an unavailable relationship query returns the input
 * rows unchanged, preserving the caller's fail-open invalidation contract.
 */
export async function filterCategoryBlogPostRowsWithoutActiveLinks<
  TRow extends object,
>(supabase: SupabaseClient, merchantId: string, rows: readonly TRow[]) {
  const postIds = Array.from(
    new Set(
      rows
        .map((row) => (row as CategoryBlogPostRow).id?.trim())
        .filter((id): id is string => Boolean(id))
    )
  );
  if (postIds.length === 0) {
    return rows;
  }

  try {
    const activePostIds = await getActiveLinkedPostIds(
      supabase,
      merchantId,
      postIds
    );
    if (!activePostIds) {
      return rows;
    }
    return rows.filter((row) => {
      const id = (row as CategoryBlogPostRow).id?.trim();
      return !id || !activePostIds.has(id);
    });
  } catch {
    return rows;
  }
}
