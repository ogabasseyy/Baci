import {
  isProductNegotiable,
  MAX_AUTO_NEGOTIATION_DISCOUNT_RATE,
} from '@baci/shared/lib';
import { unstable_cache } from 'next/cache';
import { formatAmountInCurrency } from '@/lib/resolve-merchant-currency';
import { createPublicClient } from '@/lib/supabase/public';
import type { Database } from '@/types/supabase';

const CACHE_TTL = 300;
const MAX_CHECKOUT_DISCOUNT_PERCENTAGE =
  MAX_AUTO_NEGOTIATION_DISCOUNT_RATE * 100;

export type ProductRow = {
  brand: string | null;
  max_margin_discount_percentage: number;
  max_discount_percentage: number;
  name: string;
  price: number;
};

type SantaCatalogProjection =
  Database['public']['Functions']['get_santa_catalog']['Returns'][number];

function toSantaProduct(
  product: SantaCatalogProjection,
  priceNegotiationEnabled: boolean
): ProductRow {
  const marginCeiling = Math.max(
    0,
    Math.min(40, Number(product.max_margin_discount_percentage) || 0)
  );
  const maxDiscount =
    priceNegotiationEnabled &&
    isProductNegotiable({ brand: product.brand, name: product.name })
      ? Math.min(MAX_CHECKOUT_DISCOUNT_PERCENTAGE, marginCeiling)
      : 0;

  return {
    brand: product.brand,
    max_discount_percentage: maxDiscount,
    max_margin_discount_percentage: marginCeiling,
    name: product.name,
    price: Number(product.price) || 0,
  };
}

const fetchSantaProductList = async (
  merchantId: string,
  priceNegotiationEnabled: boolean
): Promise<ProductRow[]> => {
  const supabase = createPublicClient({
    clientInfo: 'baci-santa-catalog',
  }) as ReturnType<typeof createPublicClient> & {
    rpc: (
      functionName: 'get_santa_catalog',
      args: Database['public']['Functions']['get_santa_catalog']['Args']
    ) => Promise<{
      data:
        | Database['public']['Functions']['get_santa_catalog']['Returns']
        | null;
      error: { message: string } | null;
    }>;
  };

  const { data, error } = await supabase.rpc('get_santa_catalog', {
    p_merchant_id: merchantId,
  });
  if (error) {
    throw new Error('Santa catalog is temporarily unavailable');
  }

  const products = (data ?? []).map((product) =>
    toSantaProduct(product, priceNegotiationEnabled)
  );
  const priceRanges = [
    { min: 5000000, max: 999999999, limit: 30 },
    { min: 2000000, max: 5000000, limit: 50 },
    { min: 1200000, max: 2000000, limit: 80 },
    { min: 800000, max: 1200000, limit: 100 },
    { min: 500000, max: 800000, limit: 80 },
    { min: 200000, max: 500000, limit: 80 },
    { min: 50000, max: 200000, limit: 50 },
    { min: 0, max: 50000, limit: 30 },
  ];
  const selected = priceRanges.flatMap((range) =>
    products
      .filter(
        (product) => product.price >= range.min && product.price < range.max
      )
      .slice(0, range.limit)
  );

  return Array.from(
    new Map(selected.map((product) => [product.name, product])).values()
  );
};

export const getCachedSantaProductList = unstable_cache(
  fetchSantaProductList,
  ['santa-product-list'],
  { revalidate: CACHE_TTL, tags: ['products'] }
);

const formatSantaCatalog = async (
  merchantId: string,
  priceNegotiationEnabled: boolean,
  currencyCode: string
): Promise<string> => {
  const products = await fetchSantaProductList(
    merchantId,
    priceNegotiationEnabled
  );
  if (!products.length) return '(No products available)';

  return products
    .map(
      (product) =>
        `* ${JSON.stringify(product.name)}: ${formatAmountInCurrency(product.price, currencyCode, { maximumFractionDigits: 0 })} (Maximum Discount: ${product.max_discount_percentage}%)`
    )
    .join('\n');
};

export const getCachedSantaProducts = unstable_cache(
  formatSantaCatalog,
  ['santa-products-catalog-string'],
  { revalidate: CACHE_TTL, tags: ['products'] }
);
