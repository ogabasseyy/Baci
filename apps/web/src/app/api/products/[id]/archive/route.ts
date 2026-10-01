import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateApiRequest, hasPermission } from '@/lib/api-auth';
import {
  revalidateProductSlugs,
  revalidateProducts,
} from '@/lib/cache-revalidation';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { scheduleProductBlogPurgeAfterResponse } from '@/lib/schedule-product-blog-purge-after-response';
import { scheduleStorefrontProductPurge } from '@/lib/storefront-product-purge';
import { resolveProductPurgeCategorySegmentForRow } from '@/lib/storefront-product-purge-urls';
import { archiveProductRequestSchema } from '@/schemas/archive-product';

const paramsSchema = z.object({
  id: z.uuid(),
});

/**
 * The archived product row shape: slug/name + legacy text `category` + the
 * `category_id` direct join + the `product_categories` junction, so the
 * Cloudflare purge resolves the same join-driven canonical segment the
 * storefront served (PR #2914 precedence: active direct join → active
 * junction → legacy text). Archiving only flips `status`, so the row (and its junction rows)
 * survive the update — the `update(...).select(...)` reuse avoids a separate
 * pre-read.
 */
interface ArchivedProductRow {
  id: string;
  slug: string | null;
  status: string;
  name: string | null;
  category: string | null;
  categories: unknown;
  product_categories: unknown;
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return jsonError('Unauthorized', 401);
  }

  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) {
    return csrf.response ?? jsonError('CSRF validation failed', 403);
  }

  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return jsonError('Invalid product id', 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body', 400);
  }
  const parsedBody = archiveProductRequestSchema.safeParse(body);
  if (!parsedBody.success) {
    return jsonError('Invalid request body', 400);
  }

  const merchantContext = await getMerchantForApiRequest(
    auth.supabase,
    auth.user.id,
    { requestedMerchantId: parsedBody.data.merchantId }
  );
  if (!merchantContext) {
    return jsonError('Merchant not found', 404);
  }

  const access = toUserAccess(merchantContext);
  if (!access || !hasPermission(access, 'products', 'edit')) {
    return jsonError('Permission denied', 403);
  }

  const { data: product, error } = await auth.supabase
    .from('products')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', parsedParams.data.id)
    .eq('merchant_id', merchantContext.merchantId)
    // Read the purge inputs (legacy text `category` + the `category_id` direct
    // join + the `product_categories` junction) alongside the archive so the
    // eviction below resolves the row's canonical category segment. All three
    // are immutable in this handler and survive the status flip.
    .select(
      'id, slug, status, name, category, categories:category_id(slug, is_active), product_categories(category_id, categories(slug, is_active))'
    )
    .single<ArchivedProductRow>();

  if (error) {
    if (error.code === 'PGRST116') {
      return jsonError('Product not found', 404);
    }

    return jsonError('Failed to archive product', 500);
  }

  revalidateProducts(merchantContext.merchantId, product.slug ?? undefined);

  // Archiving removes the product from listings AND changes its PDP (the
  // storefront redirects archived slugs), yet nothing else evicts the raised
  // edge TTL — the CDN would keep serving the pre-archive listing/PDP. Evict the
  // affected public URLs the same way the DELETE route does. Fire-and-forget: a
  // purge is always survivable (caches self-heal on their TTL), so it must never
  // break the archive — guard the whole derive + schedule.
  try {
    // Legacy rows can have a null/blank slug but stay addressable at
    // `/products/<id>`, so fall back to the id for the purge target.
    const purgeSlug = product.slug?.trim() || parsedParams.data.id;
    // Bust the archived slug's Next product cache BEFORE the edge purge so a
    // post-purge MISS cannot refill a stale "product still listed" page. Runs
    // first (needs only the merchant id) so a failed merchant-slug read below
    // cannot skip it.
    revalidateProductSlugs(merchantContext.merchantId, [purgeSlug]);
    // scheduleStorefrontProductPurge needs the merchant slug (the resolved
    // merchant context only yields its id). Resolve it here; a miss makes the
    // schedule a silent no-op (fail-open).
    const { data: merchantRow } = await auth.supabase
      .from('merchants')
      .select('slug')
      .eq('id', merchantContext.merchantId)
      .single<{ slug: string | null }>();
    const purgeEntries = [
      {
        slug: purgeSlug,
        categorySegment: resolveProductPurgeCategorySegmentForRow({
          slug: purgeSlug,
          name: product.name,
          category: product.category,
          categories: product.categories,
          product_categories: product.product_categories,
        }),
      },
    ];
    // Evict the archived PDP immediately; relationship/category fallback reads
    // for linked articles are queued below so they cannot delay the response.
    scheduleStorefrontProductPurge(merchantRow?.slug, purgeEntries);
    // Keep relationship/category fallback reads out of the archive response.
    // The product purge is queued after the response and the helper hard-
    // expires the merchant's related-blog cache before scheduling article URLs.
    scheduleProductBlogPurgeAfterResponse({
      supabase: auth.supabase,
      merchantId: merchantContext.merchantId,
      merchantSlug: merchantRow?.slug,
      productIds: [product.id],
      entries: purgeEntries,
      categorySlugs: [purgeEntries[0]?.categorySegment],
      skipProductPurge: true,
    });
  } catch (purgeError) {
    console.warn('Skipped Cloudflare product purge after archive', {
      purgeError,
    });
  }

  return NextResponse.json({
    product: { id: product.id, slug: product.slug, status: product.status },
    success: true,
  });
}
