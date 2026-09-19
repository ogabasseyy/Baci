import z from 'zod';

/**
 * One product whose public storefront URLs should be evicted from Cloudflare
 * alongside the tag revalidation. `slug` OR `id` is required (legacy rows with a
 * null slug stay addressable by id via `/products/<id>`); `category` (legacy
 * text) and `categorySlug` (the resolved category-join slug) are optional hints
 * used to derive the canonical PDP category segment.
 *
 * `slug` and `id` are BOTH `.nullable().optional()` to match the mobile helper's
 * `StorefrontProductRevalidateEntry` contract (`slug?: string | null`, `id?:
 * string | null`): a saved row can carry a null slug (legacy) or a null id, and
 * the caller relies on the slug-or-id fallback. The refinement still rejects an
 * entry with neither, so a null slug requires a present id (and vice versa).
 *
 * `previousCategoryId` is the OPTIONAL id of the product's PRE-SAVE category on a
 * category MOVE. Mobile saves persist only `category_id` (the legacy `category`
 * TEXT can be blank), so a caller that moved a product by id alone cannot supply
 * the old category's slug — only its id. The route resolves that id to the old
 * category slug server-side and purges the stale old listing + canonical PDP.
 * The legacy old TEXT is still carried by a separate no-id hint entry (backward
 * compatible); this field adds the id path for text-blank moves.
 */
// A blank ('' / whitespace) slug or id is treated as ABSENT rather than a
// validation failure so a caller sending `{ slug: '', id }` (legacy rows)
// falls back to the id instead of having the whole request rejected.
const blankAsNull = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

export const internalRevalidateProductEntrySchema = z
  .object({
    slug: z.preprocess(
      blankAsNull,
      z.string().trim().min(1).max(300).nullable().optional()
    ),
    id: z.preprocess(
      blankAsNull,
      z.string().trim().min(1).max(255).nullable().optional()
    ),
    category: z.string().trim().max(300).nullish(),
    categorySlug: z.string().trim().max(300).nullish(),
    previousCategoryId: z.preprocess(
      blankAsNull,
      z.string().trim().max(255).nullable().optional()
    ),
  })
  .refine((value) => Boolean(value.slug || value.id), {
    message: 'Each product requires a slug or id',
  });

export type InternalRevalidateProductEntry = z.infer<
  typeof internalRevalidateProductEntrySchema
>;

/**
 * Body for `POST /api/internal/revalidate-products` — the merchant whose
 * product caches (incl. the proxy crawl-budget slug-set) should be revalidated.
 *
 * `merchantSlug` + `products` are OPTIONAL and backward compatible: `products`
 * alone busts the per-slug Next product-detail caches; adding `merchantSlug`
 * (which identifies the storefront's cache policy) additionally schedules a
 * Cloudflare purge of the listed products' public URLs. `purgeWholeStorefront`
 * is reserved for broad structural mutations, such as a category path change,
 * where every cacheable document on that storefront must be evicted.
 * `expireProductBlogCache` is reserved for standalone workers that need the
 * merchant-scoped related-product enrichment tag hard-expired in a Next
 * request context before an edge article purge. Existing callers that send
 * only `merchantId` keep working unchanged.
 */
export const internalRevalidateProductsBodySchema = z
  .object({
    merchantId: z.string().trim().min(1).max(255),
    merchantSlug: z.string().trim().min(1).max(255).optional(),
    productSlugs: z
      .array(z.string().trim().min(1).max(300))
      .max(10_000)
      .optional(),
    products: z
      .array(internalRevalidateProductEntrySchema)
      .max(1000)
      .optional(),
    purgeWholeStorefront: z.literal(true).optional(),
    expireProductBlogCache: z.literal(true).optional(),
  })
  .superRefine((value, context) => {
    if (value.purgeWholeStorefront && !value.merchantSlug) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A whole-storefront purge requires merchantSlug',
        path: ['merchantSlug'],
      });
    }
  });
