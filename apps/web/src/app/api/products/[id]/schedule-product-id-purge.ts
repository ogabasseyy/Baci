import { revalidateProducts } from '@/lib/cache-revalidation';
import { scheduleProductMutationPurge } from '@/lib/schedule-product-mutation-purge';
import {
  resolveProductPurgeCategorySegmentForRow,
  type StorefrontProductPurgeEntry,
} from '@/lib/storefront-product-purge-urls';

type PurgeSupabaseClient = Parameters<
  typeof scheduleProductMutationPurge
>[0]['supabase'];

interface ProductPurgeRow {
  id?: string | null;
  slug?: string | null;
  name?: string | null;
  category?: string | null;
  categories?: unknown;
  product_categories?: unknown;
}

interface ScheduleUpdatedProductPurgeInput {
  supabase: PurgeSupabaseClient;
  id: string;
  merchantId: string;
  merchantSlug: string | null | undefined;
  existingProduct: ProductPurgeRow;
  updatedProduct: ProductPurgeRow & { id: string };
}

interface ScheduleDeletedProductPurgeInput {
  supabase: PurgeSupabaseClient;
  id: string;
  merchantId: string;
  merchantSlug: string | null | undefined;
  deletedProduct: ProductPurgeRow | null;
  preReadError: unknown;
  linkedBlogPostIds: string[];
  incompleteBlogSnapshot: boolean;
}

/**
 * Derive current/previous storefront purge entries and schedule a scoped
 * update purge without touching unrelated merchant PDPs; fall back to
 * immediate merchant-wide revalidation only if scheduling throws.
 */
export function scheduleUpdatedProductPurge({
  supabase,
  id,
  merchantId,
  merchantSlug,
  existingProduct,
  updatedProduct,
}: ScheduleUpdatedProductPurgeInput): void {
  try {
    const nextSlug = updatedProduct.slug?.trim() || id;
    const previousSlug = existingProduct.slug?.trim() || id;
    // Direct join (`category_id`) and junction (`product_categories`) are
    // immutable in PUT; only legacy TEXT `category` can change.
    const immutableJoins = {
      categories: existingProduct.categories,
      product_categories: existingProduct.product_categories,
    };
    const nextCategorySegment = resolveProductPurgeCategorySegmentForRow({
      slug: nextSlug,
      name: updatedProduct.name,
      category: updatedProduct.category,
      ...immutableJoins,
    });
    const productPurgeEntries: StorefrontProductPurgeEntry[] = [
      { slug: nextSlug, categorySegment: nextCategorySegment },
    ];
    const previousCategorySegment = resolveProductPurgeCategorySegmentForRow({
      slug: previousSlug,
      name: existingProduct.name,
      category: existingProduct.category,
      ...immutableJoins,
    });
    if (
      previousSlug !== nextSlug ||
      (previousCategorySegment ?? '') !== (nextCategorySegment ?? '')
    ) {
      productPurgeEntries.push({
        slug: previousSlug,
        categorySegment: previousCategorySegment,
      });
    }
    scheduleProductMutationPurge({
      supabase,
      merchantId,
      merchantSlug,
      productIds: [updatedProduct.id],
      entries: productPurgeEntries,
    });
  } catch (purgeError) {
    revalidateProducts(merchantId, updatedProduct.slug ?? undefined, {
      expireImmediately: true,
    });
    console.warn('Skipped Cloudflare product purge after update', {
      purgeError,
    });
  }
}

/**
 * Derive deleted product purge entries and schedule a scoped deletion purge,
 * expanding to a whole-storefront purge when pre-read metadata is incomplete
 * and falling back to immediate merchant-wide revalidation only on error.
 */
export function scheduleDeletedProductPurge({
  supabase,
  id,
  merchantId,
  merchantSlug,
  deletedProduct,
  preReadError,
  linkedBlogPostIds,
  incompleteBlogSnapshot,
}: ScheduleDeletedProductPurgeInput): void {
  try {
    if (deletedProduct) {
      const purgeSlug = deletedProduct.slug?.trim() || id;
      const purgeEntries: StorefrontProductPurgeEntry[] = [
        {
          slug: purgeSlug,
          categorySegment: resolveProductPurgeCategorySegmentForRow({
            slug: purgeSlug,
            name: deletedProduct.name,
            category: deletedProduct.category,
            categories: deletedProduct.categories,
            product_categories: deletedProduct.product_categories,
          }),
        },
      ];
      scheduleProductMutationPurge({
        supabase,
        merchantId,
        merchantSlug,
        productIds: [id],
        entries: purgeEntries,
        blogPostIds: linkedBlogPostIds,
        purgeWholeStorefront: incompleteBlogSnapshot,
      });
    } else {
      console.warn(
        'Product purge pre-read failed after delete; scheduling complete fallback purge',
        { id, preReadError }
      );
      scheduleProductMutationPurge({
        supabase,
        merchantId,
        merchantSlug,
        productIds: [id],
        entries: [{ slug: id, categorySegment: null }],
        blogPostIds: linkedBlogPostIds,
        purgeWholeStorefront: true,
      });
    }
  } catch (purgeError) {
    revalidateProducts(merchantId, undefined, { expireImmediately: true });
    console.warn('Skipped Cloudflare product purge after delete', {
      purgeError,
    });
  }
}
