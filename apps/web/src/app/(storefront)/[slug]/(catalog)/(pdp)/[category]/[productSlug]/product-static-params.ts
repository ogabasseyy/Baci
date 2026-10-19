import { OGABASSEY_DOMAIN, OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';
import { getCachedStorefrontProductIndex } from '@/lib/cached-storefront-product-index';
import { isPreviewPrerenderBuild } from '@/lib/prerender-preview-cap';

// Prerender ALL of OgaBassey's active PDPs at build. Coverage is load-bearing
// for SEO, not just LCP: on Vercel, only params enumerated here get a PPR
// shell with the resolved <title> baked into <head>; non-enumerated params
// render with streamed metadata forever (the PPR resume forces streaming
// regardless of `htmlLimitedBots`), which raw-HTML crawlers read as a
// missing/wrong title (Semrush 2026-07-10: bare-"Ogabassey" duplicate titles
// on PDPs older than the previous newest-200 window). The index is paged
// because a single ranged query silently truncates at PostgREST's max-rows.
const OGABASSEY_PRERENDER_PAGE_SIZE = 200;
// Safety cap (pages), not a target: 12 pages = 2,400 products, ~1.8x the
// current active catalog. Raise when the catalog approaches it.
const OGABASSEY_PRERENDER_MAX_PAGES = 12;
// Preview-target sample: the full catalog emits ~183k cold files that never
// finish the preview finalize step, so preview builds prerender only the
// priority PDP below plus this many newest index products. Production is
// unaffected — the gate is an exact `VERCEL_ENV=preview` match.
export const OGABASSEY_PREVIEW_PRERENDER_PRODUCT_LIMIT = 11;
const OGABASSEY_PREVIEW_PRERENDER_MAX_PAGES = 1;
export const PRERENDER_PLACEHOLDER_STORE_SLUG =
  '__prerender_placeholder_store__';
export const PRERENDER_PLACEHOLDER_PRODUCT_SLUG = '__prerender_placeholder__';
// Keep the actively monitored, revenue-critical PDP pinned first in the
// prerender set so it survives even a partially-failed index walk.
const OGABASSEY_PRIORITY_PRERENDER_PRODUCTS = [
  {
    category: 'gaming-laptops',
    productSlug: 'dell-alienware-m18-r3-rtx-5080',
  },
] as const;

export async function resolveProductStaticParams(): Promise<
  Array<{ slug: string; category: string; productSlug: string }>
> {
  // cacheComponents requires generateStaticParams to return >= 1 param; this
  // placeholder keeps the build valid (and renders notFound) if the index is
  // empty/unavailable. Real, non-listed products still render on demand.
  const placeholder = [
    {
      slug: PRERENDER_PLACEHOLDER_STORE_SLUG,
      category: 'smartphones',
      productSlug: PRERENDER_PLACEHOLDER_PRODUCT_SLUG,
    },
  ];

  const products: Awaited<
    ReturnType<typeof getCachedStorefrontProductIndex>
  >['products'] = [];
  let indexFailed = false;
  const previewBuild = isPreviewPrerenderBuild();
  const maxPages = previewBuild
    ? OGABASSEY_PREVIEW_PRERENDER_MAX_PAGES
    : OGABASSEY_PRERENDER_MAX_PAGES;
  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const result = await getCachedStorefrontProductIndex(
        OGABASSEY_MERCHANT_ID,
        {
          page,
          limit: OGABASSEY_PRERENDER_PAGE_SIZE,
        }
      );
      if (result.hasError) {
        // A failed page stops the walk but keeps every product already
        // collected: shipping a partial prerender set beats failing the build
        // or dropping to the placeholder-only shell.
        indexFailed = true;
        break;
      }
      products.push(...result.products);
      if (result.products.length < OGABASSEY_PRERENDER_PAGE_SIZE) {
        break;
      }
    }
  } catch {
    // A rejected index lookup at build/prerender time must not throw and fail
    // the whole prerender step; fall through with whatever pages resolved.
    indexFailed = true;
  }

  // Placeholder only when the index FAILED before yielding anything. An empty
  // but successful index still prerenders the pinned priority PDPs below.
  if (products.length === 0 && indexFailed) {
    return placeholder;
  }

  const seen = new Set<string>();
  const params: Array<{ slug: string; category: string; productSlug: string }> =
    [];

  for (const product of OGABASSEY_PRIORITY_PRERENDER_PRODUCTS) {
    const key = `${product.category}/${product.productSlug}`;
    seen.add(key);
    params.push({ slug: OGABASSEY_DOMAIN, ...product });
  }

  const collected = previewBuild
    ? products.slice(0, OGABASSEY_PREVIEW_PRERENDER_PRODUCT_LIMIT)
    : products;
  for (const product of collected) {
    const category = product.category_slug?.trim();
    const productSlug = product.slug?.trim();
    if (!category || !productSlug) {
      continue;
    }
    const key = `${category}/${productSlug}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    params.push({ slug: OGABASSEY_DOMAIN, category, productSlug });
  }

  return params.length > 0 ? params : placeholder;
}
