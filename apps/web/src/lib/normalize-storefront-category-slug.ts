/**
 * Canonical legacy → modern storefront category slug aliases.
 *
 * Single source of truth for both `normalizeStorefrontCategorySlug` (used when
 * emitting internal hrefs and canonical URLs) and the URL rewrite logic in
 * `apps/web/src/lib/storefront-link-normalization.ts` (which matches both the
 * key and value forms in its `INTERNAL_STOREFRONT_PREFIX` regex). Adding a new
 * alias here is enough — the link-normalization regex derives its alternation
 * from `Object.keys(STOREFRONT_CATEGORY_ALIASES)` and the canonical values.
 *
 * NOTE: These aliases are intentional platform-wide defaults that normalize
 * known legacy slugs into their modern forms. Merchants that deliberately
 * store one of the alias keys as a category slug accept the platform's
 * canonicalization — this matches the paired redirect rules in
 * `next.config.ts` that 301 `/phones/*` → `/smartphones/*` etc.
 */
export const STOREFRONT_CATEGORY_ALIASES: Readonly<Record<string, string>> =
  Object.freeze({
    accesories: 'accessories',
    phone: 'smartphones',
    phones: 'smartphones',
    laptop: 'laptops',
  });

export function normalizeStorefrontCategorySlug(
  slug: string | null | undefined
): string | null {
  const normalized = slug?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (Object.hasOwn(STOREFRONT_CATEGORY_ALIASES, normalized)) {
    return STOREFRONT_CATEGORY_ALIASES[normalized];
  }

  return normalized;
}
