import { cache } from 'react';
import { mapHomeProductsToTemplateProducts } from '@/app/(storefront)/ogabassey/ogabassey-home-product-adapter';
import { OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';
import { BLACK_FRIDAY_PRODUCT_SLUGS } from '@/config/ogabassey-black-friday';
import {
  getCachedMerchant,
  type StorefrontHomeProduct,
} from '@/lib/cached-data';
import { getCachedStorefrontProductsBySlugs } from '@/lib/cached-storefront-products-by-slugs';
import { formatCurrencyWithConfig } from '@/lib/currency';
import { normalizeProductKeySpecs } from '@/lib/product-key-specs-normalize';
import { getProductUrl } from '@/lib/product-url';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';

export function isPublishedOgabassey(
  merchant: { id: string; is_published?: boolean | null } | null
): boolean {
  return (
    merchant?.id === OGABASSEY_MERCHANT_ID && merchant.is_published === true
  );
}

export function selectBlackFridayProducts<T extends StorefrontHomeProduct>(
  products: readonly T[],
  slugs: readonly string[]
): T[] {
  const available = new Map<string, T>();
  for (const product of products) {
    const price = Number(product.advertised_price ?? product.price);
    const stock = product.stock_quantity ?? product.stock ?? 0;
    if (
      product.slug &&
      Number.isFinite(price) &&
      price > 0 &&
      (!product.manage_stock ||
        stock > 0 ||
        ('availability' in product && product.availability === 'InStock'))
    ) {
      available.set(product.slug, product);
    }
  }

  return [...new Set(slugs)].flatMap((slug) => {
    const product = available.get(slug);
    return product ? [product] : [];
  });
}

export function getBlackFridayProductSpecs(raw: unknown) {
  const specs = normalizeProductKeySpecs(raw);
  function text(key: string) {
    const value = specs?.[key];
    return typeof value === 'string' ? value.trim() || undefined : undefined;
  }
  function measurement(key: string, unit: string) {
    const value = specs?.[key];
    const amount =
      typeof value === 'number' || typeof value === 'string'
        ? Number(value)
        : 0;
    return Number.isFinite(amount) && amount > 0
      ? `${amount} ${unit}`
      : undefined;
  }
  return {
    storage: measurement('storage_gb', 'GB'),
    ram: measurement('ram_gb', 'GB'),
    graphics: text('gpu'),
    colors: text('available_colors')
      ?.split(',')
      .map((color) => color.trim())
      .filter(Boolean),
    simType: text('sim_type'),
    displayType: text('display_type'),
    displaySize: measurement('screen_size_inches', 'inches'),
  };
}

const conditionLabels = {
  new: 'New',
  used: 'Used',
  open_box: 'Open Box',
  refurbished: 'refurbished',
} as const;

export const getBlackFridayProducts = cache(async () => {
  if (BLACK_FRIDAY_PRODUCT_SLUGS.length === 0) return [];

  const merchant = await getCachedMerchant('ogabassey');
  if (!merchant || !isPublishedOgabassey(merchant)) return [];

  const rows = await getCachedStorefrontProductsBySlugs(
    merchant.id,
    BLACK_FRIDAY_PRODUCT_SLUGS,
    true
  );
  const lineup = selectBlackFridayProducts(rows, BLACK_FRIDAY_PRODUCT_SLUGS);
  const products = mapHomeProductsToTemplateProducts(lineup);
  const specsById = new Map(
    lineup.map((row) => [row.id, row.product_key_specs])
  );
  const currency = resolveMerchantCurrencyConfig(merchant);

  return products.flatMap((product) => {
    if (!product.slug) return [];
    const compareAt = product.compare_at_price;
    return [
      {
        id: product.id,
        name: product.name,
        slug: product.slug,
        image: product.image,
        ...getBlackFridayProductSpecs(specsById.get(product.id)),
        brand: (product.brand ?? '').trim(),
        condition: product.condition
          ? conditionLabels[product.condition]
          : undefined,
        rawPrice: product.price,
        priceAmount: product.price,
        price: formatCurrencyWithConfig(product.price, currency),
        compareAtPrice:
          compareAt && compareAt > product.price
            ? formatCurrencyWithConfig(compareAt, currency)
            : undefined,
        href: getProductUrl(product),
      },
    ];
  });
});
