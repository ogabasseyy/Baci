import { sanitizeText, stripHtmlTags } from '@/lib/sanitize-core';

interface PublishPayloadProduct {
  id: string;
  name: string;
  description?: string;
  sku?: string | null;
  price: number;
  stock?: number;
  image?: string;
  images?: Array<string | { url?: string }>;
  variants?: Array<{
    sku?: string | null;
    price_override?: number | null;
    stock_quantity?: number;
    is_inventory_anchor?: boolean;
  }>;
}

const CATALOG_PLACEHOLDER_PATH = '/placeholder.png';

function isAbsoluteHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isCatalogPlaceholderImage(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || trimmed === CATALOG_PLACEHOLDER_PATH) {
    return true;
  }

  if (
    trimmed.endsWith('/placeholder.png') ||
    trimmed.endsWith('placeholder.png')
  ) {
    return true;
  }

  try {
    return new URL(trimmed).pathname.endsWith('/placeholder.png');
  } catch {
    return false;
  }
}

function getProductVariations(product: PublishPayloadProduct) {
  const sourceVariants = product.variants ?? [];
  const sellableVariants = sourceVariants.filter(
    (variant) =>
      typeof variant.sku === 'string' &&
      variant.sku.trim() &&
      variant.is_inventory_anchor !== true
  );

  if (sellableVariants.length > 0) {
    return sellableVariants.map((variant) => ({
      sellerSku: variant.sku?.trim() ?? '',
      price: variant.price_override ?? product.price,
      stock: variant.stock_quantity,
    }));
  }

  if (!product.sku?.trim()) return [];
  return [
    {
      sellerSku: product.sku.trim(),
      price: product.price,
      stock: product.stock,
    },
  ];
}

function collectPublishImageUrls(product: PublishPayloadProduct): string[] {
  const imageUrls = (product.images ?? [])
    .map((image) =>
      typeof image === 'string' ? image.trim() : image.url?.trim()
    )
    .filter((url): url is string =>
      Boolean(url && isAbsoluteHttpUrl(url) && !isCatalogPlaceholderImage(url))
    );

  if (imageUrls.length === 0 && product.image) {
    const trimmed = product.image.trim();
    if (isAbsoluteHttpUrl(trimmed) && !isCatalogPlaceholderImage(trimmed)) {
      imageUrls.push(trimmed);
    }
  }

  return imageUrls;
}

function hasNonAnchorVariantMissingSku(
  product: PublishPayloadProduct
): boolean {
  return (product.variants ?? []).some(
    (variant) =>
      variant.is_inventory_anchor !== true &&
      (typeof variant.sku !== 'string' || !variant.sku.trim())
  );
}

export function getJumiaPublishBlockReason(
  product: PublishPayloadProduct
): string | null {
  if (hasNonAnchorVariantMissingSku(product)) {
    return 'Add a SKU for every variant before submitting to Jumia.';
  }

  const variations = getProductVariations(product);
  if (variations.length === 0) {
    return 'Add a SKU for every variant before submitting to Jumia.';
  }

  if (variations.some((variation) => variation.price <= 0)) {
    return 'Set a price greater than zero before submitting to Jumia.';
  }

  if (collectPublishImageUrls(product).length === 0) {
    return 'Upload a product image before submitting to Jumia.';
  }

  return null;
}

export function buildJumiaPublishPayload(
  product: PublishPayloadProduct,
  integrationId: string,
  categoryCode: number,
  brand: { code: number; name: string },
  currency: string
) {
  const imageUrls = collectPublishImageUrls(product);
  return {
    integrationId,
    productId: product.id,
    name: sanitizeText(stripHtmlTags(product.name)),
    brand: { code: brand.code, name: sanitizeText(stripHtmlTags(brand.name)) },
    category: { code: categoryCode },
    description: sanitizeText(
      stripHtmlTags(product.description || product.name)
    ),
    images: imageUrls.map((url, index) => ({ url, primary: index === 0 })),
    variations: getProductVariations(product).map((variation) => ({
      sellerSku: variation.sellerSku,
      price: variation.price,
      currency,
      stock: variation.stock,
    })),
  };
}
