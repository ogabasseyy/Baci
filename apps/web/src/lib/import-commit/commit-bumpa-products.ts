import type { SupabaseClient } from '@supabase/supabase-js';
import type { NormalizedImportedProduct } from '@/lib/imports/bumpa/bumpa-types';
import { normalizeStorefrontCategoryValue } from '@/lib/normalize-storefront-category-value';
import { revalidateProductsReliable } from '@/lib/revalidate-products-reliable';
import { generateProductSlug } from '@/lib/seo-utils';
import type { InternalRevalidateProductEntry } from '@/schemas/internal-revalidate-products-route';
import { boundImportPurgeEntries } from './bound-import-purge-entries';
import {
  type CommitProgressCallback,
  createCommitProgress,
} from './import-commit-progress';

interface CommitBumpaProductsInput {
  supabase: SupabaseClient;
  merchantId: string;
  importJobId: string;
  products: NormalizedImportedProduct[];
  onProgress?: CommitProgressCallback;
}

interface ExistingProductRecord {
  category?: string | null;
  id: string;
  slug: string | null;
  external_id: string | null;
  external_source: string | null;
}

interface CommitBumpaProductsResult {
  createdProducts: number;
  updatedProducts: number;
}

function buildProductImages(product: NormalizedImportedProduct) {
  return product.images.map((url) => ({
    url,
    alt: product.title,
  }));
}

function resolveUniqueSlug(
  baseSlug: string,
  usedSlugs: Set<string>,
  existingSlug: string | null
) {
  if (existingSlug) {
    usedSlugs.add(existingSlug);
    return existingSlug;
  }

  let candidate = baseSlug;
  let suffix = 2;
  while (usedSlugs.has(candidate)) {
    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  usedSlugs.add(candidate);
  return candidate;
}

export async function commitBumpaProducts({
  supabase,
  merchantId,
  importJobId,
  products,
  onProgress,
}: CommitBumpaProductsInput): Promise<CommitBumpaProductsResult> {
  const existingProducts: ExistingProductRecord[] = [];
  const pageSize = 1000;

  for (let start = 0; ; start += pageSize) {
    const end = start + pageSize - 1;
    const { data, error } = await supabase
      .from('products')
      .select('id, slug, category, external_id, external_source')
      .eq('merchant_id', merchantId)
      .order('id', { ascending: true })
      .range(start, end);

    if (error) {
      throw new Error(`Failed to load existing products: ${error.message}`);
    }

    const page = (data || []) as ExistingProductRecord[];
    existingProducts.push(...page);

    if (page.length < pageSize) {
      break;
    }
  }

  const usedSlugs = new Set<string>();
  const productsByExternalId = new Map<string, ExistingProductRecord>();

  for (const product of existingProducts) {
    if (product.slug) {
      usedSlugs.add(product.slug);
    }

    if (product.external_id && product.external_source === 'bumpa') {
      productsByExternalId.set(product.external_id, product);
    }
  }

  let createdProducts = 0;
  let updatedProducts = 0;
  let hasCategoryMove = false;
  // Accumulate the changed/created products so the reliable revalidation can also
  // evict their public storefront URLs from Cloudflare (the slug/category are in
  // hand at write time). Created rows carry no id (the insert does not RETURN one
  // to keep the write cheap); their slug is enough to address the PDP.
  const changedProducts: InternalRevalidateProductEntry[] = [];

  try {
    const progress = createCommitProgress(products.length, onProgress);

    for (const product of products) {
      const existingProduct = productsByExternalId.get(
        product.externalSourceId
      );
      const baseSlug =
        generateProductSlug(product.title) || product.externalSourceId;
      const slug = resolveUniqueSlug(
        baseSlug,
        usedSlugs,
        existingProduct?.slug || null
      );
      const payload = {
        merchant_id: merchantId,
        name: product.title,
        description: product.description,
        price: product.price,
        stock_quantity: product.stock,
        stock: product.stock,
        manage_stock: product.manageStock,
        category: product.category,
        sku: product.sku,
        status: product.status,
        slug,
        images: buildProductImages(product),
        image_small: product.images[0] || null,
        image_large: product.images[0] || null,
        external_source: product.sourcePlatform,
        external_id: product.externalSourceId,
        import_job_id: importJobId,
        imported_at: new Date().toISOString(),
        metadata: {
          import_metadata: product.importMetadata,
        },
        created_at: product.sourceCreatedAt || undefined,
        updated_at: product.sourceUpdatedAt || undefined,
      };

      if (existingProduct) {
        if (
          existingProduct.category !== undefined &&
          normalizeStorefrontCategoryValue(existingProduct.category) !==
            normalizeStorefrontCategoryValue(product.category)
        ) {
          // Category-fallback blog rails are derived from the post-update
          // category. A move also invalidates the old category's rail, so use
          // the bounded hostname purge rather than trying to reconstruct every
          // old fallback article from the import payload.
          hasCategoryMove = true;
        }
        const { error: updateError } = await supabase
          .from('products')
          .update(payload)
          .eq('id', existingProduct.id)
          // Tenant scoping (defense-in-depth): this runs via a service-role
          // client (RLS bypassed), so scope the mutation to the merchant even
          // though existingProduct.id was loaded merchant-scoped.
          .eq('merchant_id', merchantId);

        if (updateError) {
          throw new Error(
            `Failed to update imported product: ${updateError.message}`
          );
        }

        updatedProducts += 1;
        changedProducts.push({
          slug,
          id: existingProduct.id,
          category: product.category,
        });
        await progress.reportNext();
        continue;
      }

      const { error: insertError } = await supabase
        .from('products')
        .insert(payload);
      if (insertError) {
        throw new Error(
          `Failed to create imported product: ${insertError.message}`
        );
      }

      createdProducts += 1;
      changedProducts.push({ slug, category: product.category });
      await progress.reportNext();
    }
  } finally {
    // Invalidate product caches so imported products are immediately reflected —
    // including the crawl-budget product slug-set the proxy hard-404 relies on.
    // In `finally` so that if a LATER row throws after earlier rows already
    // committed, those committed slugs are still revalidated — otherwise a
    // partially-imported live product would be absent from the slug-set (which
    // the proxy hard-404 reads) and 404ed until the cacheLife TTL expires.
    if (createdProducts > 0 || updatedProducts > 0) {
      // RELIABLE across contexts: in-process `revalidateTag` when a Next store
      // context exists (cron route / dashboard), or an internal Bearer HTTP
      // call from the standalone CLI worker (no store context). Never throws —
      // a missing context must not break the import.
      try {
        // Resolve the storefront slug ONCE per commit run (not per product) so
        // the reliable helper can additionally evict the changed products' public
        // URLs from Cloudflare. A missing/blank slug (or a lookup miss) degrades
        // to Next-cache-only revalidation — the pre-existing behavior. The
        // helper's listings-only threshold bounds the fan-out for large imports.
        const { data: merchantRow, error: merchantLookupError } = await supabase
          .from('merchants')
          .select('slug')
          .eq('id', merchantId)
          .maybeSingle();
        if (merchantLookupError) {
          // Fail-open: log for observability but degrade to Next-cache-only
          // revalidation below — a stale storefront cache self-heals on its
          // TTL, so a failed lookup must never break the import.
          console.warn(
            'Failed to resolve merchant slug for import Cloudflare product purge (degrading to Next-cache-only revalidation):',
            { importJobId, merchantId, error: merchantLookupError }
          );
        }
        const merchantSlug = merchantRow?.slug ?? null;
        const purgeProducts = boundImportPurgeEntries(changedProducts);
        const nextProductSlugs = Array.from(
          new Set(
            changedProducts
              .map((product) => product.slug?.trim())
              .filter((slug): slug is string => Boolean(slug))
          )
        );
        const purgeWholeStorefront =
          hasCategoryMove || purgeProducts.length < changedProducts.length;
        const revalidationOptions = {
          ...(merchantSlug && purgeProducts.length > 0
            ? {
                merchantSlug,
                products: purgeProducts,
                supabase,
                ...(purgeWholeStorefront ? { purgeWholeStorefront: true } : {}),
              }
            : {}),
          nextProductSlugs,
        };
        await revalidateProductsReliable(
          merchantId,
          nextProductSlugs.length > 0 ? revalidationOptions : undefined
        );
      } catch (error) {
        console.error(
          'Failed to revalidate product caches after import (non-fatal):',
          error
        );
      }
    }
  }

  return {
    createdProducts,
    updatedProducts,
  };
}
