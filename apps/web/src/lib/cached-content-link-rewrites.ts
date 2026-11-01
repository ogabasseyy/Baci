import { cacheLife, cacheTag } from 'next/cache';
import { getBlogContentLinksCacheTag } from '@/lib/blog-content-link-cache-tags';
import { getPublicSupabaseClient } from '@/lib/cached-data';
import { getCachedProductCanonicalPaths } from '@/lib/cached-product-canonical-paths';
import { getCachedStorefrontProductSlugResolution } from '@/lib/cached-storefront-product-slug-resolution';
import { isPublicBlogPost } from '@/lib/public-blog-content-quality';
import { applyPublicBlogSqlFilters } from '@/lib/public-blog-sql-filters';
import { getProductUrl } from '@/lib/seo-utils';
import type { StorefrontContentLinkRewrites } from '@/lib/storefront-content-link-rewriting';
import { UUID_SHAPED_PRODUCT_IDENTIFIER_REGEX } from '@/lib/storefront-content-link-targets';
import { normalizeStorefrontContentHref } from '@/lib/storefront-link-normalization';

const EMPTY_REWRITES: StorefrontContentLinkRewrites = {
  blogSlugs: {},
  productPaths: {},
};

const CAPACITY_VARIANT_SUFFIX_REGEX =
  /-(?:\d+gb-)?\d+(?:gb|tb)(?:-(?:5g|4g))?$/i;

async function resolveBlogSlugRewrites(
  merchantId: string,
  blogSlugs: string[]
): Promise<Record<string, string>> {
  if (blogSlugs.length === 0) {
    return {};
  }

  const supabase = getPublicSupabaseClient();
  const { data: redirects, error: redirectsError } = await supabase
    .from('blog_post_redirects')
    .select('source_slug, target_post_id')
    .eq('merchant_id', merchantId)
    .in('source_slug', blogSlugs);

  if (redirectsError) {
    throw redirectsError;
  }

  const targetIdBySource = new Map<string, string>();
  for (const row of redirects ?? []) {
    if (row.source_slug && row.target_post_id) {
      targetIdBySource.set(row.source_slug, row.target_post_id);
    }
  }
  if (targetIdBySource.size === 0) {
    return {};
  }

  // Mirror the public blog route's suppression filters: a redirect pointing
  // at a published-but-suppressed post must not count as a rewrite, or the
  // source link would be "fixed" onto a target the route 404s. Also check the
  // SOURCE slugs: the route consults blog_post_redirects only after the post
  // lookup misses, so a stale redirect row for a slug that is live again must
  // not rewrite links away from the post the route actually serves.
  const [
    { data: targets, error: targetsError },
    { data: liveSources, error: liveSourcesError },
  ] = await Promise.all([
    applyPublicBlogSqlFilters(
      supabase
        .from('blog_posts')
        .select('id, slug, title')
        .eq('merchant_id', merchantId)
        .eq('status', 'published')
        .not('published_at', 'is', null)
        .in('id', Array.from(new Set(targetIdBySource.values())))
    ),
    applyPublicBlogSqlFilters(
      supabase
        .from('blog_posts')
        .select('slug, title')
        .eq('merchant_id', merchantId)
        .eq('status', 'published')
        .not('published_at', 'is', null)
        .in('slug', Array.from(targetIdBySource.keys()))
    ),
  ]);

  if (targetsError) {
    throw targetsError;
  }
  if (liveSourcesError) {
    throw liveSourcesError;
  }

  for (const row of liveSources ?? []) {
    if (row.slug && isPublicBlogPost(row)) {
      targetIdBySource.delete(row.slug);
    }
  }

  const slugById = new Map(
    (targets ?? []).flatMap((row) =>
      row.slug && isPublicBlogPost(row) ? [[row.id, row.slug]] : []
    )
  );
  const rewrites: Record<string, string> = {};
  for (const [sourceSlug, targetId] of targetIdBySource) {
    const targetSlug = slugById.get(targetId);
    if (targetSlug && targetSlug !== sourceSlug) {
      rewrites[sourceSlug] = targetSlug;
    }
  }

  return rewrites;
}

// Least-privilege archived-alias resolution — no service-role access anywhere
// in this public render path. Candidates resolve through the anon-callable
// SECURITY DEFINER RPC the proxy already uses for its 308 decisions
// (get_merchant_product_slug_resolution, which matches UUID-shaped input
// against product ids since 20260625053000); the redirect target carries its
// own category join, so the canonical path is the exact URL the PDP itself
// would 308 to.
async function resolveArchivedRedirectPaths(
  merchantId: string,
  slugCandidates: string[]
): Promise<Map<string, string>> {
  const pathByCandidate = new Map<string, string>();

  await Promise.all(
    slugCandidates.map(async (slug) => {
      const resolution = await getCachedStorefrontProductSlugResolution(
        merchantId,
        slug
      );
      if (resolution.hasError) {
        // Propagate so getCachedContentLinkRewrites rejects and the caller's
        // fail-open guard suppresses unwrapping instead of misreading the
        // failure as "no rewrite exists".
        throw new Error(`Product slug resolution failed for "${slug}"`);
      }
      if (resolution.redirectTarget) {
        pathByCandidate.set(slug, getProductUrl(resolution.redirectTarget));
      }
    })
  );

  return pathByCandidate;
}

// Active products linked by UUID rewrite to their canonical slug path, the
// same resolution the PDP applies before redirecting id-shaped URLs.
async function resolveActiveUuidSlugs(
  merchantId: string,
  uuidCandidates: string[]
): Promise<Map<string, string>> {
  const slugByUuid = new Map<string, string>();
  if (uuidCandidates.length === 0) {
    return slugByUuid;
  }

  const supabase = getPublicSupabaseClient();
  const { data, error } = await supabase
    .from('products')
    .select('id, slug')
    .eq('merchant_id', merchantId)
    .eq('status', 'active')
    .in('id', uuidCandidates);

  if (error) {
    throw error;
  }

  for (const row of data ?? []) {
    if (row.id && row.slug) {
      slugByUuid.set(row.id.toLowerCase(), row.slug);
    }
  }

  return slugByUuid;
}

/**
 * Resolves canonical replacements for internal content links that would
 * otherwise resolve through permanent redirects: renamed blog posts (via
 * blog_post_redirects), re-categorized live products, archived variant
 * products consolidated into an active parent, and UUID-shaped product links.
 * Complements getCachedDeadContentLinkSlugs — slugs with a rewrite here must
 * NOT be treated as dead, or working links would be unwrapped instead of
 * fixed.
 *
 * Every lookup in this flow throws on query errors (including
 * getCachedProductCanonicalPaths via throwOnQueryError) so Cache Components
 * skips caching the failure and callers fail open — a transient error can
 * never be misread as "no rewrite exists" and unwrap a redirectable link.
 */
export async function getCachedContentLinkRewrites(
  merchantId: string,
  blogSlugs: string[],
  productSlugs: string[]
): Promise<StorefrontContentLinkRewrites> {
  // PR4b review round 4: stays `'use cache: remote'` (demotion REVERTED).
  // Tagged with this merchant's derived blog-content-links tag, the generic
  // blog-content-links compatibility tag, product-legacy-redirect,
  // `products-${id}`, and `categories-${id}`. Live revalidators bust the
  // matching tags. Link rewriting is exactly the contract that must propagate:
  // after a product is archived or a blog slug renamed, an instance holding a
  // LOCAL entry would keep rewriting links to a dead target. Already fail-loud
  // (every lookup throws so the failure is never cached and callers fail open).
  'use cache: remote';
  cacheLife('merchant');
  cacheTag(
    getBlogContentLinksCacheTag(merchantId),
    'blog-content-links',
    'product-legacy-redirect',
    `products-${merchantId}`,
    `categories-${merchantId}`
  );

  if (blogSlugs.length === 0 && productSlugs.length === 0) {
    return EMPTY_REWRITES;
  }

  const slugCandidates = productSlugs.filter(
    (slug) => !UUID_SHAPED_PRODUCT_IDENTIFIER_REGEX.test(slug)
  );
  const uuidCandidates = productSlugs.filter((slug) =>
    UUID_SHAPED_PRODUCT_IDENTIFIER_REGEX.test(slug)
  );

  const [blogRewrites, livePaths, activeSlugByUuid] = await Promise.all([
    resolveBlogSlugRewrites(merchantId, blogSlugs),
    slugCandidates.length
      ? getCachedProductCanonicalPaths(merchantId, slugCandidates, {
          throwOnQueryError: true,
        })
      : Promise.resolve({}),
    resolveActiveUuidSlugs(merchantId, uuidCandidates),
  ]);

  const productPaths: Record<string, string> = { ...livePaths };

  // Archived aliases: only candidates that did not resolve to a live product.
  const archivedPaths = await resolveArchivedRedirectPaths(merchantId, [
    ...slugCandidates.filter((slug) => !Object.hasOwn(productPaths, slug)),
    ...uuidCandidates.filter(
      (uuid) => !activeSlugByUuid.has(uuid.toLowerCase())
    ),
  ]);
  for (const [candidate, path] of archivedPaths) {
    productPaths[candidate] = path;
  }

  // Variant capacity suffix fallback: resolve authored RAM/storage variant
  // slugs (e.g. `google-pixel-6-8gb-256gb`) to the live parent model path.
  const baseSlugByCandidate = new Map<string, string>();
  for (const candidate of slugCandidates) {
    if (Object.hasOwn(productPaths, candidate)) continue;
    const stripped = candidate.replace(CAPACITY_VARIANT_SUFFIX_REGEX, '');
    if (stripped && stripped !== candidate) {
      baseSlugByCandidate.set(candidate, stripped);
    }
  }
  if (baseSlugByCandidate.size > 0) {
    const baseSlugsToLookup = Array.from(
      new Set(baseSlugByCandidate.values())
    ).filter((baseSlug) => !Object.hasOwn(productPaths, baseSlug));
    const basePaths = baseSlugsToLookup.length
      ? await getCachedProductCanonicalPaths(merchantId, baseSlugsToLookup, {
          throwOnQueryError: true,
        })
      : {};
    for (const [candidate, baseSlug] of baseSlugByCandidate) {
      const basePath = Object.hasOwn(productPaths, baseSlug)
        ? productPaths[baseSlug]
        : basePaths[baseSlug];
      if (basePath) productPaths[candidate] = basePath;
    }
  }

  // Active products linked by UUID: canonical path of their real slug.
  const activeUuidSlugs = Array.from(new Set(activeSlugByUuid.values())).filter(
    (slug) => !Object.hasOwn(productPaths, slug)
  );
  const activeUuidPaths = activeUuidSlugs.length
    ? await getCachedProductCanonicalPaths(merchantId, activeUuidSlugs, {
        throwOnQueryError: true,
      })
    : {};
  for (const [uuid, slug] of activeSlugByUuid) {
    const slugPath = Object.hasOwn(productPaths, slug)
      ? productPaths[slug]
      : activeUuidPaths[slug];
    if (slugPath) productPaths[uuid] = slugPath;
  }

  // Stored category slugs can be legacy aliases (phones, laptop, ...) that
  // the content normalizer has already rewritten out of authored links.
  // Normalize every rewrite path the same way so a rewrite can never flip a
  // canonicalized link back to an alias path (the rewriter also self-skips
  // when the normalized path equals the existing href).
  const normalizedProductPaths: Record<string, string> = {};
  for (const [slug, path] of Object.entries(productPaths)) {
    normalizedProductPaths[slug] = normalizeStorefrontContentHref(path, {});
  }

  return { blogSlugs: blogRewrites, productPaths: normalizedProductPaths };
}
