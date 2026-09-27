import type { PublishProduct } from '@/schemas/jumia/publish-products';
import {
  MAX_PRODUCT_PAGES,
  publishProductSchema,
  publishProductsPageSchema,
} from '@/schemas/jumia/publish-products';

export type JumiaProductMappingState = {
  variantId?: string | null;
  sellerSku: string;
  syncStatus: string;
};

export async function loadMappedProductMappings(
  integrationId: string,
  signal: AbortSignal
): Promise<Map<string, JumiaProductMappingState[]>> {
  const response = await fetch(
    `/api/marketplace/jumia/products/mapped-product-ids?integrationId=${integrationId}`,
    { signal }
  );
  if (!response.ok) {
    throw new Error('Failed to load mapped Jumia products');
  }
  const payload: unknown = await response.json();
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('mappings' in payload) ||
    !Array.isArray(payload.mappings)
  ) {
    throw new Error('Failed to load mapped Jumia products');
  }

  const mappedProducts = new Map<string, JumiaProductMappingState[]>();
  for (const mapping of payload.mappings) {
    if (
      typeof mapping !== 'object' ||
      mapping === null ||
      !('productId' in mapping) ||
      typeof mapping.productId !== 'string' ||
      !mapping.productId.trim() ||
      !('sellerSku' in mapping) ||
      typeof mapping.sellerSku !== 'string' ||
      !mapping.sellerSku.trim() ||
      !('syncStatus' in mapping) ||
      typeof mapping.syncStatus !== 'string' ||
      !mapping.syncStatus.trim()
    ) {
      throw new Error('Failed to load mapped Jumia products');
    }

    const productId = mapping.productId.trim();
    let variantId: string | null | undefined;
    if ('variantId' in mapping) {
      if (mapping.variantId !== null && typeof mapping.variantId !== 'string') {
        throw new Error('Failed to load mapped Jumia products');
      }
      variantId =
        typeof mapping.variantId === 'string'
          ? mapping.variantId.trim()
          : mapping.variantId;
      if (typeof variantId === 'string' && !variantId) {
        throw new Error('Failed to load mapped Jumia products');
      }
    }
    const mappings = mappedProducts.get(productId) ?? [];
    const mappingState: JumiaProductMappingState = {
      sellerSku: mapping.sellerSku.trim(),
      syncStatus: mapping.syncStatus,
    };
    if ('variantId' in mapping) {
      mappingState.variantId = variantId;
    }
    mappings.push(mappingState);
    mappedProducts.set(productId, mappings);
  }

  return mappedProducts;
}

export async function loadPublishProducts(
  search: string | undefined,
  signal: AbortSignal
): Promise<PublishProduct[]> {
  const products: PublishProduct[] = [];
  let page = 1;
  const limit = 100;

  for (;;) {
    const params = new URLSearchParams({
      status: 'active',
      limit: String(limit),
      page: String(page),
    });
    if (search?.trim()) {
      params.set('search', search.trim());
    }

    const response = await fetch(`/api/products?${params}`, { signal });
    if (!response.ok) throw new Error('Failed to load active products');
    const payload: unknown = await response.json();
    const parsed = publishProductsPageSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error('Failed to load active products');
    }

    const pageProducts = parsed.data.products.flatMap((product) => {
      const validated = publishProductSchema.safeParse(product);
      return validated.success ? [validated.data] : [];
    });
    products.push(...pageProducts);

    const totalPages = parsed.data.pagination?.totalPages ?? 1;
    if (
      page >= Math.min(totalPages, MAX_PRODUCT_PAGES) ||
      pageProducts.length === 0
    ) {
      break;
    }
    page += 1;
  }

  return products;
}
