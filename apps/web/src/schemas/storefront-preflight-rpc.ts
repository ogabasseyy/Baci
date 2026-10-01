import { z } from 'zod';

/**
 * RPC function names — shared constants so the two PDP helpers issue
 * byte-identical calls (the transport memo collapses them into one round trip
 * per navigation).
 */
export const STOREFRONT_PDP_PREFLIGHT_RPC = 'get_storefront_pdp_preflight';
export const STOREFRONT_BLOG_POST_STATUS_RPC =
  'get_storefront_blog_post_status';
export const STOREFRONT_BLOG_LISTING_STATUS_RPC =
  'get_storefront_blog_listing_status';
export const STOREFRONT_AUTH_MERCHANT_RPC = 'resolve_storefront_auth_merchant';

/** Minimal publication projection for the compare hard-status fast path. */
export const storefrontAuthMerchantRowSchema = z.object({
  is_published: z.boolean(),
});

export type StorefrontAuthMerchantRow = z.infer<
  typeof storefrontAuthMerchantRowSchema
>;

/**
 * Row contracts for the storefront preflight verdict RPCs
 * (`get_storefront_pdp_preflight`, `get_storefront_blog_post_status`, and the
 * publication projection from `resolve_storefront_auth_merchant` —
 * supabase/migrations/20260706200000_add_storefront_preflight_rpcs.sql).
 *
 * PostgREST returns table-returning RPC results as an array of rows; both
 * functions guarantee EXACTLY one row for any input (invalid/oversized input
 * degrades to `storefront_status: 'unknown'`). `storefront_status` is kept a
 * tolerant string (not a literal union) so a mixed-deploy caller never
 * hard-fails parsing a future status value — consumers compare against the
 * known values and fail open otherwise.
 */
export const storefrontPdpPreflightRowSchema = z.object({
  storefront_status: z.string(),
  catalog_nonempty: z.boolean(),
  present: z.boolean(),
  match_kind: z.string(),
  product_id: z.string().nullable(),
  product_name: z.string().nullable(),
  product_slug: z.string().nullable(),
  product_category: z.string().nullable(),
  category_id: z.string().nullable(),
  category_name: z.string().nullable(),
  category_slug: z.string().nullable(),
});

export type StorefrontPdpPreflightRow = z.infer<
  typeof storefrontPdpPreflightRowSchema
>;

export const storefrontBlogPostStatusRowSchema = z.object({
  storefront_status: z.string(),
  blog_enabled: z.boolean(),
  live_present: z.boolean(),
  redirect_target_slug: z.string().nullable(),
});

export type StorefrontBlogPostStatusRow = z.infer<
  typeof storefrontBlogPostStatusRowSchema
>;

/**
 * Row contract for `get_storefront_blog_listing_status`
 * (supabase/migrations/20260706230000_add_blog_listing_preflight_rpc.sql).
 *
 * The RPC returns RAW listing data only; TS composes every href/clamp/label
 * (mirroring what `getCachedBlogListing` feeds the resolver). `categories` and
 * `category_counts` are parallel arrays (`categories[i]` pairs with
 * `category_counts[i]`), where each `categories[i]` is the RAW (untrimmed)
 * `blog_posts.category` value so a TS exact-string lookup reproduces the
 * resolver's `.eq('category', X)` count. `total_count` is the merchant's total
 * published-post count (no category filter); `author_count` is the
 * published-post count for the single author name passed in (0 when none). As
 * with the sibling rows, `storefront_status` stays a tolerant string so a
 * mixed-deploy caller never hard-fails on a future status value.
 */
export const storefrontBlogListingStatusRowSchema = z.object({
  storefront_status: z.string(),
  blog_enabled: z.boolean(),
  total_count: z.number(),
  categories: z.array(z.string()),
  category_counts: z.array(z.number()),
  author_count: z.number(),
});

export type StorefrontBlogListingStatusRow = z.infer<
  typeof storefrontBlogListingStatusRowSchema
>;
