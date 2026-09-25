import type { JumiaClient } from '@/lib/jumia/client';
import { JumiaFeedCreateResponseSchema } from '@/schemas/jumia';
import { validateRequiredString } from './feeds-validation';

export async function updatePrice(
  client: JumiaClient,
  updates: Array<{
    sellerSku: string;
    id: string;
    price: {
      value: number;
      currency: string;
      salePrice?: {
        value: number | null;
        startAt: string | null;
        endAt: string | null;
      };
    };
    category?: { code: number };
    businessClients?: Array<{
      businessClientCode: string;
      price: {
        value: number;
        currency: string;
        salePrice?: {
          value: number | null;
          startAt: string | null;
          endAt: string | null;
        };
      };
    }>;
  }>
): Promise<string> {
  if (!updates.length) {
    throw new Error('updates must be a non-empty array');
  }
  const validatedUpdates = updates.map((item) => {
    const sellerSku = validateRequiredString(
      item.sellerSku,
      'sellerSku',
      'updatePrice'
    );
    const id = validateRequiredString(item.id, 'id', 'updatePrice');
    if (!Number.isFinite(item.price.value) || item.price.value < 0) {
      throw new Error(
        `updatePrice: price.value must be a number >= 0 for sellerSku "${sellerSku}"`
      );
    }
    if (!item.price.currency?.trim()) {
      throw new Error(
        `updatePrice: price.currency must be a non-empty string for sellerSku "${sellerSku}"`
      );
    }
    if (
      item.price.salePrice?.value != null &&
      (!Number.isFinite(item.price.salePrice.value) ||
        item.price.salePrice.value < 0)
    ) {
      throw new Error(
        `updatePrice: salePrice.value must be a number >= 0 for sellerSku "${sellerSku}"`
      );
    }
    if (item.price.salePrice?.startAt != null) {
      if (Number.isNaN(Date.parse(item.price.salePrice.startAt))) {
        throw new Error(
          `updatePrice: salePrice.startAt must be a valid ISO date for sellerSku "${sellerSku}"`
        );
      }
    }
    if (item.price.salePrice?.endAt != null) {
      if (Number.isNaN(Date.parse(item.price.salePrice.endAt))) {
        throw new Error(
          `updatePrice: salePrice.endAt must be a valid ISO date for sellerSku "${sellerSku}"`
        );
      }
    }
    if (
      item.price.salePrice?.startAt != null &&
      item.price.salePrice?.endAt != null &&
      new Date(item.price.salePrice.startAt) >
        new Date(item.price.salePrice.endAt)
    ) {
      throw new Error(
        `updatePrice: salePrice.startAt must be <= endAt for sellerSku "${sellerSku}"`
      );
    }
    if (item.category?.code != null) {
      if (!Number.isFinite(item.category.code) || item.category.code <= 0) {
        throw new Error(
          `updatePrice: category.code must be a positive number for sellerSku "${sellerSku}"`
        );
      }
    }
    return {
      ...item,
      sellerSku,
      id,
      price: { ...item.price, currency: item.price.currency.trim() },
    };
  });
  const response = await client.request(
    'POST',
    '/feeds/products/price',
    JumiaFeedCreateResponseSchema,
    { products: validatedUpdates }
  );
  return response.feedId;
}
