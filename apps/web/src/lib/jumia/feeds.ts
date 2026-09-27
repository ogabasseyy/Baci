/**
 * Jumia Vendor Center API — Feeds submodule
 * Product create/update, stock, price, status, feed status
 */

import type { JumiaClient } from '@/lib/jumia/client';
import { JumiaApiError } from '@/lib/jumia/helpers';
import type { JumiaFeedDetailsResponse } from '@/schemas/jumia';
import {
  JumiaFeedCreateResponseSchema,
  JumiaFeedDetailsResponseSchema,
} from '@/schemas/jumia';
import {
  validatePositiveNumber,
  validateRequiredString,
  validateVariation,
} from './feeds-validation';
import { verifyJumiaSingleMarketplaceScope } from './verify-jumia-single-marketplace-scope';

export { updatePrice } from './feeds-price';
export { updateStatus } from './feeds-status';

// ── Shared Helpers ──

// ── Product Create ──

export async function createProduct(
  client: JumiaClient,
  shopId: string,
  products: Array<{
    name: { value: string };
    brand: { code: number; name: string };
    category: { code: number };
    description?: { value: string };
    images?: Array<{ url: string; primary?: boolean }>;
    variations?: Array<{
      sellerSku: string;
      globalPrice: { value: number; currency: string };
      stock?: number;
      attributes?: Array<{ id: string; value: string }>;
    }>;
  }>
): Promise<string> {
  const trimmedShopId = shopId.trim();
  if (!trimmedShopId) {
    throw new Error('shopId must be a non-empty string');
  }
  if (!products.length) {
    throw new Error('products must be a non-empty array');
  }
  const validatedProducts = products.map((product) => {
    // Always validate required product-level fields
    const trimmedName = validateRequiredString(
      product.name.value,
      'name.value',
      'createProduct'
    );
    const trimmedBrandName = validateRequiredString(
      product.brand.name,
      'brand.name',
      'createProduct'
    );
    validatePositiveNumber(product.brand.code, 'brand.code', 'createProduct');
    validatePositiveNumber(
      product.category.code,
      'category.code',
      'createProduct'
    );
    const base = {
      ...product,
      name: { value: trimmedName },
      brand: { ...product.brand, name: trimmedBrandName },
    };
    if (!product.variations?.length) return base;
    return {
      ...base,
      variations: product.variations.map((variation, i) => {
        validateVariation(variation, i, 'createProduct');
        return {
          ...variation,
          sellerSku: validateRequiredString(
            variation.sellerSku,
            'sellerSku',
            'createProduct'
          ),
          globalPrice: {
            ...variation.globalPrice,
            currency: variation.globalPrice.currency.trim(),
          },
        };
      }),
    };
  });
  const response = await client.request(
    'POST',
    '/feeds/products/create',
    JumiaFeedCreateResponseSchema,
    { shopId: trimmedShopId, products: validatedProducts }
  );
  return response.feedId;
}

// ── Product Update ──

export async function updateProduct(
  client: JumiaClient,
  shopId: string,
  products: Array<{
    id: string;
    name?: { value: string };
    brand?: { code: number; name: string };
    description?: { value: string };
    images?: Array<{ url: string; primary?: boolean }>;
  }>
): Promise<string> {
  const trimmedShopId = shopId.trim();
  if (!trimmedShopId) {
    throw new Error('shopId must be a non-empty string');
  }
  if (!products.length) {
    throw new Error('products must be a non-empty array');
  }
  const validatedProducts = products.map((product) => {
    const id = validateRequiredString(product.id, 'id', 'updateProduct');
    const name = product.name
      ? {
          value: validateRequiredString(
            product.name.value,
            'name.value',
            'updateProduct'
          ),
        }
      : undefined;
    const brand = product.brand
      ? {
          ...product.brand,
          name: validateRequiredString(
            product.brand.name,
            'brand.name',
            'updateProduct'
          ),
          code: validatePositiveNumber(
            product.brand.code,
            'brand.code',
            'updateProduct'
          ),
        }
      : undefined;
    return {
      ...product,
      id,
      ...(name && { name }),
      ...(brand && { brand }),
    };
  });
  const response = await client.request(
    'POST',
    '/feeds/products/update',
    JumiaFeedCreateResponseSchema,
    { shopId: trimmedShopId, products: validatedProducts }
  );
  return response.feedId;
}

// ── Stock Update ──

export async function updateStock(
  client: JumiaClient,
  updates: Array<{ sellerSku: string; id: string; stock: number }>
): Promise<string> {
  if (!updates.length) {
    throw new Error('updates must be a non-empty array');
  }
  const trimmedUpdates = updates.map((item) => {
    const sellerSku = validateRequiredString(
      item.sellerSku,
      'sellerSku',
      'updateStock'
    );
    const id = validateRequiredString(item.id, 'id', 'updateStock');
    if (
      !Number.isFinite(item.stock) ||
      !Number.isInteger(item.stock) ||
      item.stock < 0
    ) {
      throw new Error(
        `updateStock: stock must be >= 0 for sellerSku "${sellerSku}"`
      );
    }
    return { ...item, sellerSku, id };
  });
  // The stock-feed contract has no business-client selector. Refuse to send
  // an unscoped feed when a shop has multiple active marketplaces. OAuth
  // shops require provider proof because one OAuth shop can expose several
  // business clients that the stock payload cannot address.
  const marketplaceScope = await verifyJumiaSingleMarketplaceScope(client, {
    strictOAuth: true,
  });
  if (!marketplaceScope.ok) {
    const status =
      marketplaceScope.reason === 'provider_unavailable' ? 502 : 400;
    throw new JumiaApiError(
      status,
      marketplaceScope.reason === 'provider_unavailable'
        ? 'Unable to verify the selected Jumia marketplace. Try again.'
        : 'Jumia stock updates cannot target a selected marketplace when the provider stock-feed contract has no business-client selector.'
    );
  }
  const response = await client.request(
    'POST',
    '/feeds/products/stock',
    JumiaFeedCreateResponseSchema,
    { products: trimmedUpdates }
  );
  return response.feedId;
}

// ── Feed Status ──

export async function getFeedStatus(
  client: JumiaClient,
  feedId: string
): Promise<JumiaFeedDetailsResponse> {
  const trimmedFeedId = feedId.trim();
  if (!trimmedFeedId) {
    throw new Error('feedId must be a non-empty string');
  }

  return await client.request(
    'GET',
    `/feeds/${encodeURIComponent(trimmedFeedId)}`,
    JumiaFeedDetailsResponseSchema
  );
}
