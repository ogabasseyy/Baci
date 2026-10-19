import z from 'zod';

/**
 * Path param for `GET /api/internal/slug-set/[identifier]` — the storefront
 * slug or custom domain the proxy resolved.
 */
export const internalSlugSetParamsSchema = z.object({
  identifier: z.string().trim().min(1).max(255),
});

/** Query param: the product slug whose membership is being tested. */
export const internalSlugSetQuerySchema = z.object({
  slug: z.string().trim().min(1).max(255),
});

/** Query params for blog post status resolution. */
export const internalBlogPostStatusQuerySchema = z.object({
  slug: z.string().trim().min(1).max(255),
});

/** Query params for product canonical redirect resolution. */
export const internalProductCanonicalRedirectQuerySchema = z.object({
  category: z.string().trim().min(1).max(255),
  slug: z.string().trim().min(1).max(255),
});

const listingStatusText = z.string().trim().min(1).max(255);
// Mirror the route's parseBlogListingPage cap (MAX_BLOG_LISTING_PAGE = 10_000)
// so the preflight can never request a larger Supabase offset than the route.
const listingStatusPage = z.coerce.number().int().min(1).max(10_000);

/**
 * Query params for blog **listing** hard-status resolution — a discriminated
 * union over `kind` that mirrors `BlogListingStatusIntent`. `page` arrives as a
 * string from the URL, so it is coerced.
 */
export const internalBlogListingStatusQuerySchema = z.discriminatedUnion(
  'kind',
  [
    z.object({
      kind: z.literal('category-query'),
      category: listingStatusText,
    }),
    z.object({
      kind: z.literal('listing-page'),
      page: listingStatusPage,
      category: listingStatusText.optional(),
    }),
    z.object({
      kind: z.literal('category-page'),
      categorySlug: listingStatusText,
      page: listingStatusPage,
    }),
    z.object({
      kind: z.literal('author'),
      authorSlug: listingStatusText,
      page: listingStatusPage.default(1),
    }),
  ]
);

/** Query params for category compare-hub emptiness resolution. */
export const internalCompareHubStatusQuerySchema = z.object({
  category: z.string().trim().min(1).max(255),
});

/** Query params for a category compare-pair hard-status resolution. */
export const internalComparePageStatusQuerySchema = z.object({
  category: z.string().trim().min(1).max(255),
  // A comparison slug is two bounded product keys plus `-vs-`; allow the
  // encoded-key form without making the internal endpoint an unbounded input
  // sink. The resolver applies per-key slug-safety gates before any cache key.
  comparison: z.string().trim().min(1).max(1024),
});

/**
 * Response body contract for `GET /api/internal/compare-hub-status/[identifier]`
 * — shared by the route and the proxy's empty-hub preflight so a shape change
 * fails at compile time on both sides. `hasError: true` marks a fail-open
 * verdict the proxy must treat as renderable.
 */
export const internalCompareHubStatusBodySchema = z.object({
  empty: z.boolean(),
  hasError: z.boolean(),
});

export type InternalCompareHubStatusBody = z.infer<
  typeof internalCompareHubStatusBodySchema
>;

/**
 * Response body for the compare-pair preflight. `hasError` is an explicit
 * fail-open bit: `{ present: false, hasError: true }` must never become a
 * proxy 404.
 */
export const internalComparePageStatusBodySchema = z.object({
  hasError: z.boolean(),
  present: z.boolean(),
});

export type InternalComparePageStatusBody = z.infer<
  typeof internalComparePageStatusBodySchema
>;
