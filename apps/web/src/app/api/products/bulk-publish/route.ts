import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/api-auth';
import {
  revalidateProductSlugs,
  revalidateProducts,
} from '@/lib/cache-revalidation';
import { checkCsrfProtection } from '@/lib/csrf';
import { expireProductBlogCache } from '@/lib/expire-product-blog-cache';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { scheduleProductBlogPurgeAfterResponse } from '@/lib/schedule-product-blog-purge-after-response';
import { scheduleStorefrontProductPurge } from '@/lib/storefront-product-purge';
import {
  type ProductPurgeCategoryRow,
  resolveProductPurgeCategorySegmentForRow,
  type StorefrontProductPurgeEntry,
} from '@/lib/storefront-product-purge-urls';
import { createClient } from '@/lib/supabase/server';

/**
 * Bulk Publish Products API
 *
 * POST - Delete draft products and publish all remaining products
 */

export async function POST(request: NextRequest) {
  const { valid, response } = await checkCsrfProtection(request);
  if (!valid) {
    return (
      response ??
      NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
    );
  }

  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get merchant (supports both owners and staff members)
    const merchantContext = await getMerchantForApiRequest(supabase, user.id);
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }
    const access = toUserAccess(merchantContext);
    if (!hasPermission(access, 'products', 'edit')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }
    const merchantId = merchantContext.merchantId;

    // Delete draft products
    const { data: deletedDrafts, error: deleteError } = await supabase
      .from('products')
      .delete()
      .eq('merchant_id', merchantId)
      .eq('status', 'draft')
      .select('id');

    if (deleteError) {
      console.error('Error deleting drafts:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete draft products' },
        { status: 500 }
      );
    }

    // Update all remaining products to active (valid statuses: draft, active, archived)
    const { data: updatedProducts, error: updateError } = await supabase
      .from('products')
      .update({ status: 'active' })
      .eq('merchant_id', merchantId)
      .neq('status', 'active')
      .select(
        'id, slug, name, category, categories:category_id(slug, is_active), product_categories(category_id, categories(slug, is_active))'
      );

    if (updateError) {
      console.error('Error publishing products:', updateError);
      return NextResponse.json(
        { error: 'Failed to publish products' },
        { status: 500 }
      );
    }

    // Invalidate product caches after bulk publish
    revalidateProducts(merchantId);

    // Draft rows deleted above were never public and intentionally do not add
    // edge purge targets. Every returned update is now active, so it needs a
    // PDP/listing purge using the row's canonical category resolution.
    const publicPurgeEntries: StorefrontProductPurgeEntry[] = [];
    for (const product of updatedProducts ?? []) {
      const productRow = product as ProductPurgeCategoryRow;
      const purgeSlug = productRow.slug?.trim() || productRow.id?.trim();
      if (!purgeSlug) {
        continue;
      }
      publicPurgeEntries.push({
        slug: purgeSlug,
        categorySegment: resolveProductPurgeCategorySegmentForRow(productRow),
      });
    }

    if (publicPurgeEntries.length > 0) {
      // Bust the per-slug Next entries before a Cloudflare MISS can repopulate
      // from them. The purge is best-effort and cannot change a publish result.
      try {
        revalidateProductSlugs(
          merchantId,
          publicPurgeEntries.map((entry) => entry.slug)
        );
        // Relationship/category fallback reads can span many pages. Queue the
        // article enrichment after the response so publishing cannot time out
        // after the database update has already committed.
        // Expire the merchant-scoped article enrichment before a URL or
        // hostname purge can trigger a cache refill with the pre-publish
        // product snapshot. The post-response enrichment also expires this
        // tag, but it runs in a separate task and therefore cannot protect the
        // purge scheduled immediately below.
        expireProductBlogCache(merchantId);
        scheduleStorefrontProductPurge(
          merchantContext.merchantSlug,
          publicPurgeEntries
        );
        scheduleProductBlogPurgeAfterResponse({
          supabase,
          merchantId,
          merchantSlug: merchantContext.merchantSlug,
          productIds: (updatedProducts ?? []).map((product) => product.id),
          entries: publicPurgeEntries,
          categorySlugs: publicPurgeEntries.map(
            (entry) => entry.categorySegment
          ),
          skipProductPurge: true,
        });
      } catch (purgeError) {
        console.warn('Skipped Cloudflare product purge after bulk publish', {
          purgeError,
        });
      }
    }

    return NextResponse.json({
      success: true,
      deletedDrafts: deletedDrafts?.length || 0,
      publishedProducts: updatedProducts?.length || 0,
    });
  } catch (error) {
    console.error('Bulk publish error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
