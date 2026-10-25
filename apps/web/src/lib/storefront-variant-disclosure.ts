/** Public selection facts shared by discovery feeds and purchasing summaries. */
export interface StorefrontVariantSelection {
  id: string;
  attributes?: Record<string, unknown> | null;
  condition?: string | null;
}

const PRIVATE_ATTRIBUTE_KEYS = new Set([
  'gtin',
  'mpn',
  'variantid',
  'variant_id',
  'color_hex',
  'colour_hex',
  'colorhex',
  'colourhex',
]);

export function getStorefrontVariantOptions(
  variant: StorefrontVariantSelection
): Record<string, string> {
  const options: Record<string, string> = {};
  for (const [key, value] of Object.entries(variant.attributes ?? {})) {
    const name = key
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
    if (!name || PRIVATE_ATTRIBUTE_KEYS.has(name)) continue;
    const text =
      typeof value === 'string'
        ? value.trim()
        : typeof value === 'number' && Number.isFinite(value)
          ? String(value)
          : '';
    if (text) options[name === 'colour' ? 'color' : name] = text;
  }
  if (variant.condition) options.condition = variant.condition;
  return options;
}

export function buildStorefrontVariantTitle(
  name: string,
  variant: StorefrontVariantSelection
): string {
  const values = Object.entries(getStorefrontVariantOptions(variant)).map(
    ([key, value]) =>
      key === 'condition'
        ? value
            .replaceAll('_', ' ')
            .replace(/\b\w/g, (letter) => letter.toUpperCase())
        : value
  );
  return [name, ...values].join(' - ');
}

export function buildStorefrontVariantUrl(
  productUrl: string,
  variant: StorefrontVariantSelection
): string {
  const url = new URL(productUrl);
  url.searchParams.set('variantId', variant.id);
  for (const [key, value] of Object.entries(
    getStorefrontVariantOptions(variant)
  )) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function isRestrictedWifiOnlyVariant(
  variant: Pick<StorefrontVariantSelection, 'attributes'>
): boolean {
  const options = getStorefrontVariantOptions({ ...variant, id: '' });
  return ['sim_type', 'connectivity'].some((key) =>
    /^wi[\s-]*fi\s*only$/i.test(options[key] ?? '')
  );
}

export interface StorefrontVariantProductContext {
  name?: string | null;
  category?: string | null;
  category_slug?: string | null;
  categories?:
    | { name?: string | null; slug?: string | null }
    | Array<{ name?: string | null; slug?: string | null }>
    | null;
}

export function isCellularPhoneProduct(
  product: StorefrontVariantProductContext
): boolean {
  const joinedCategories = Array.isArray(product.categories)
    ? product.categories
    : [product.categories];
  const categories = [
    product.category,
    product.category_slug,
    ...joinedCategories.flatMap((category) => [category?.name, category?.slug]),
  ]
    .filter(Boolean)
    .join(' ');
  if (/\b(tablets?|ipads?|laptops?|computers?)\b/i.test(categories))
    return false;
  return (
    /(?:^|[\s/_-])(?:smartphones?|phones?|feature[\s_-]*phones?)(?:$|[\s/_-])/i.test(
      categories
    ) ||
    /\b(?:iphone|google pixel|pixel \d|galaxy [sazmf]\d)/i.test(
      product.name ?? ''
    )
  );
}

/** Phone defaults exclude restricted units; normal Wi-Fi tablets stay eligible. */
export function filterDefaultAdvertisedVariants<
  T extends { attributes?: Record<string, unknown> | null },
>(variants: readonly T[], product: StorefrontVariantProductContext): T[] {
  return isCellularPhoneProduct(product)
    ? variants.filter((variant) => !isRestrictedWifiOnlyVariant(variant))
    : [...variants];
}

export function getVariantConnectivityDisclosure(
  variant: StorefrontVariantSelection
): string | undefined {
  return isRestrictedWifiOnlyVariant(variant)
    ? 'Listed as Wi-Fi only. Do not assume cellular service support; confirm connectivity limitations before purchase.'
    : undefined;
}
