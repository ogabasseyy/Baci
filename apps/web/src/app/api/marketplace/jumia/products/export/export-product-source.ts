import type { SupabaseClient } from '@supabase/supabase-js';
import { getEffectiveStock } from '@/lib/product-stock';
import { sanitizeText, stripHtmlTags } from '@/lib/sanitize-core';

export type ExportVariation = {
  sellerSku: string;
  price: number;
  currency: string;
  stock?: number;
  attributes?: Array<{ id: string; value: string }>;
};

export type ResolvedExportProduct = {
  productId: string;
  name: string;
  description?: string;
  images?: Array<{ url: string; primary?: boolean }>;
  variations: ExportVariation[];
  variantIdsBySku: Map<string, string>;
};

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  sku: string | null;
  stock_quantity: number | null;
  stock: number | null;
  images: unknown;
  has_variants: boolean | null;
  status?: string | null;
};

type VariantRow = {
  id: string;
  sku: string | null;
  price_override: number | null;
  stock_quantity: number;
  is_inventory_anchor: boolean | null;
};

function isAbsoluteHttpImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function parseExportProductImages(
  images: unknown
): Array<{ url: string; primary?: boolean }> {
  if (!Array.isArray(images)) return [];
  const parsed: Array<{ url: string; primary?: boolean }> = [];
  for (const image of images) {
    const url =
      typeof image === 'string'
        ? image.trim()
        : image &&
            typeof image === 'object' &&
            'url' in image &&
            typeof image.url === 'string'
          ? image.url.trim()
          : '';
    if (!url || !isAbsoluteHttpImageUrl(url)) continue;
    parsed.push({ url, primary: parsed.length === 0 });
  }
  return parsed;
}

function isPositiveFinitePrice(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function buildVariationsFromProduct(
  product: ProductRow,
  variants: VariantRow[],
  currency: string
): {
  variations: ExportVariation[];
  variantIdsBySku: Map<string, string>;
  error?: string;
} {
  const variantIdsBySku = new Map<string, string>();
  const sellableVariants = variants.filter(
    (variant) => !variant.is_inventory_anchor
  );

  if (sellableVariants.length > 0) {
    const missingSkuVariant = sellableVariants.find(
      (variant) => typeof variant.sku !== 'string' || !variant.sku.trim()
    );
    if (missingSkuVariant) {
      return {
        variations: [],
        variantIdsBySku,
        error: 'Every product variant must have a SKU before export to Jumia',
      };
    }

    const normalizedSkus = sellableVariants.map(
      (variant) => variant.sku?.trim() ?? ''
    );
    if (new Set(normalizedSkus).size !== normalizedSkus.length) {
      return {
        variations: [],
        variantIdsBySku,
        error: 'Product variants must have unique SKUs before export to Jumia',
      };
    }

    const invalidPriceVariant = sellableVariants.find((variant) => {
      const price = Number(variant.price_override ?? product.price);
      return !isPositiveFinitePrice(price);
    });
    if (invalidPriceVariant) {
      return {
        variations: [],
        variantIdsBySku,
        error:
          'Every product variant must have a positive price before export to Jumia',
      };
    }

    const variations = sellableVariants.flatMap((variant) => {
      const sellerSku = variant.sku?.trim() ?? '';
      const price = Number(variant.price_override ?? product.price);
      variantIdsBySku.set(sellerSku, variant.id);
      return [
        {
          sellerSku,
          price,
          currency,
          stock: variant.stock_quantity,
        },
      ];
    });
    return { variations, variantIdsBySku };
  }

  const sellerSku = product.sku?.trim();
  if (!sellerSku) {
    return {
      variations: [],
      variantIdsBySku,
      error: 'Product must have a SKU before it can be exported to Jumia',
    };
  }

  const price = Number(product.price);
  if (!isPositiveFinitePrice(price)) {
    return {
      variations: [],
      variantIdsBySku,
      error:
        'Product must have a positive price before it can be exported to Jumia',
    };
  }

  // Canonical fallback: a legacy product with stock_quantity = 0 but a
  // positive legacy stock value exports the legacy value, not zero.
  const hasStockValue = product.stock_quantity != null || product.stock != null;
  return {
    variations: [
      {
        sellerSku,
        price,
        currency,
        stock: hasStockValue ? getEffectiveStock(product) : undefined,
      },
    ],
    variantIdsBySku,
  };
}

export async function resolveAuthorizedExportProduct(
  supabase: SupabaseClient,
  merchantId: string,
  productId: string,
  currency: string
): Promise<
  | { ok: true; product: ResolvedExportProduct }
  | { ok: false; status: number; error: string }
> {
  const { data: product, error: productError } = await supabase
    .from('products')
    .select(
      'id, name, description, price, sku, stock_quantity, stock, images, has_variants, status'
    )
    .eq('merchant_id', merchantId)
    .eq('id', productId)
    .eq('status', 'active')
    .maybeSingle();

  if (productError) {
    return {
      ok: false,
      status: 500,
      error: 'Failed to load product for Jumia export',
    };
  }
  if (!product) {
    return { ok: false, status: 404, error: 'Product not found' };
  }

  const { data: variants, error: variantsError } = await supabase
    .from('product_variants')
    .select('id, sku, price_override, stock_quantity, is_inventory_anchor')
    .eq('merchant_id', merchantId)
    .eq('product_id', productId);

  if (variantsError) {
    return {
      ok: false,
      status: 500,
      error: 'Failed to load product variants for Jumia export',
    };
  }

  const built = buildVariationsFromProduct(
    product as ProductRow,
    (variants ?? []) as VariantRow[],
    currency
  );
  if (built.error || built.variations.length === 0) {
    return {
      ok: false,
      status: 400,
      error: built.error ?? 'Product has no exportable SKUs',
    };
  }

  const safeName =
    sanitizeText(stripHtmlTags((product as ProductRow).name)) || '[Untitled]';
  const safeDescription = (product as ProductRow).description
    ? sanitizeText(
        stripHtmlTags((product as ProductRow).description ?? '')
      )?.trim()
    : undefined;

  return {
    ok: true,
    product: {
      productId: (product as ProductRow).id,
      name: safeName,
      description: safeDescription || undefined,
      images: parseExportProductImages((product as ProductRow).images),
      variations: built.variations,
      variantIdsBySku: built.variantIdsBySku,
    },
  };
}
