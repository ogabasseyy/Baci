import { describe, expect, it, vi } from 'vitest';
import type { ChatProductResult } from '@/ai/chat-product-result';
import { buildFastCatalogReply } from './fast-catalog-reply';

const categories = [{ id: 'phones', name: 'Smartphones', slug: 'smartphones' }];
const product: ChatProductResult = {
  brand: 'Apple',
  category: 'Smartphones',
  description: null,
  has_variants: false,
  id: 'phone-1',
  image_url: null,
  manage_stock: false,
  name: 'iPhone 16',
  price: 200_000,
  slug: 'iphone-16',
  status: 'active',
  stock: 0,
};

describe('buildFastCatalogReply', () => {
  it('returns only server-owned catalog products and does not claim an unverified gaming ranking', async () => {
    const load = vi.fn(async () => [product]);
    const result = await buildFastCatalogReply(
      ['Best gaming phones'],
      categories,
      load
    );

    expect(result?.events[0]?.products.map((item) => item.name)).toEqual([
      'iPhone 16',
    ]);
    expect(result?.text).toContain('iPhone 16');
    expect(result?.text).toContain('catalog marks these for gaming');
    expect(result?.text).not.toMatch(/best gaming|snapdragon|\b2024\b/i);
    expect(result?.catalogChecked).toBe(true);
  });

  it('returns a safe message if the catalog lookup fails', async () => {
    const result = await buildFastCatalogReply(
      ['Show me phones'],
      categories,
      async () => {
        throw new Error('database unavailable');
      }
    );
    expect(result?.events).toEqual([]);
    expect(result?.text).toMatch(/couldn.t|unable|unavailable/i);
    expect(result?.text).not.toContain('iPhone');
    expect(result?.unavailable).toBe(true);
  });

  it('marks invalid presentation data as unavailable rather than a verified empty search', async () => {
    const result = await buildFastCatalogReply(
      ['Show me phones'],
      categories,
      async () => [{ ...product, price: Number.NaN }]
    );
    expect(result?.unavailable).toBe(true);
    expect(result?.catalogChecked).toBeUndefined();
  });

  it('leaves order and payment questions to the existing route', async () => {
    const load = vi.fn(async () => [product]);
    expect(
      await buildFastCatalogReply(['Cancel my iPhone order'], categories, load)
    ).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('does not claim that a bounded empty search proves the store has no matching product', async () => {
    const result = await buildFastCatalogReply(
      ['Phones under 500k'],
      categories,
      async () => []
    );
    expect(result?.events).toEqual([]);
    expect(result?.unavailable).toBeUndefined();
    expect(result?.catalogChecked).toBe(true);
    expect(result?.text).not.toMatch(
      /(?:do not|don.t|no longer) (?:have|sell)/i
    );
  });

  it('explains when it cannot verify the requested product options', async () => {
    const load = vi.fn(async () => [product]);
    const result = await buildFastCatalogReply(
      ['Show me used phones'],
      categories,
      load
    );
    expect(result?.events).toEqual([]);
    expect(result?.text).toMatch(/condition|options/i);
    expect(load).not.toHaveBeenCalled();
  });

  it('asks for a product type rather than searching a categoryless Pro Plus model', async () => {
    const load = vi.fn(async () => [product]);
    const result = await buildFastCatalogReply(
      ['Do you have Tecno Spark 40 Pro+?'],
      categories,
      load
    );
    expect(result?.events).toEqual([]);
    expect(result?.text).toMatch(/phone or an accessory/i);
    expect(load).not.toHaveBeenCalled();
  });

  it('asks for the full model again after a short product-type answer', async () => {
    const load = vi.fn(async () => [product]);
    const result = await buildFastCatalogReply(
      ['Do you have Tecno Spark 40 Pro+ under 300k?', 'A phone'],
      categories,
      load
    );
    expect(result?.events).toEqual([]);
    expect(result?.text).toMatch(/repeat.*product name/i);
    expect(load).not.toHaveBeenCalled();
  });

  it('does not load a broad phone list after a type and budget reply', async () => {
    const load = vi.fn(async () => [product]);
    const result = await buildFastCatalogReply(
      ['Do you have Tecno Spark 40 Pro+?', 'A phone under 300k'],
      categories,
      load
    );
    expect(result?.events).toEqual([]);
    expect(result?.text).toMatch(/repeat.*product name/i);
    expect(load).not.toHaveBeenCalled();
  });

  it('asks customers to distinguish a Max model from their budget', async () => {
    const load = vi.fn(async () => [product]);
    const result = await buildFastCatalogReply(
      ['Do you have iPhone 15 max ₦500k?'],
      categories,
      load
    );
    expect(result?.events).toEqual([]);
    expect(result?.text).toMatch(/max.*product name.*budget/i);
    expect(result?.text).toMatch(/under/i);
    expect(load).not.toHaveBeenCalled();
  });

  it.each([
    ['Show me phones under 500 USD', 'NGN'],
    ['Show me phones under 500k naira', 'USD'],
  ])('asks for a store-currency budget without searching: %s', async (text, currency) => {
    const load = vi.fn(async () => [product]);
    const result = await buildFastCatalogReply(
      [text],
      categories,
      load,
      currency
    );
    expect(result?.text).toMatch(/store.s currency/i);
    expect(result?.text).toMatch(/can.t convert/i);
    expect(result?.text).toMatch(/at most 5000/i);
    expect(load).not.toHaveBeenCalled();
  });

  it('tells customers to include the product when restarting an unsupported range', async () => {
    const load = vi.fn(async () => [product]);
    const result = await buildFastCatalogReply(
      ['Show phones between 100k and 500k', 'At most 300k'],
      categories,
      load,
      'NGN'
    );
    expect(result?.text).toMatch(/new message.*product type.*at most/i);
    expect(load).not.toHaveBeenCalled();
    await buildFastCatalogReply(
      ['Show phones between 100k and 500k', 'Phones at most 300k'],
      categories,
      load,
      'NGN'
    );
    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({ maxPrice: 300_000, exclusiveMaxPrice: false })
    );
  });

  it('searches the clarified product within the stated budget', async () => {
    const load = vi.fn(async () => [product]);
    await buildFastCatalogReply(
      ['Do you have iPhone 15 max ₦500k?', 'iPhone 15 under ₦500k'],
      categories,
      load
    );
    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'iPhone 15', maxPrice: 500_000 })
    );
  });

  it('tells customers to check accessory compatibility', async () => {
    const result = await buildFastCatalogReply(
      ['Show me chargers'],
      categories,
      async () => [product]
    );
    expect(result?.text).toMatch(/compatib/i);
  });

  it('asks the customer which item they mean after a broad search', async () => {
    const result = await buildFastCatalogReply(
      ['Show phones', 'How much is it?'],
      categories,
      async () => [product]
    );
    expect(result?.text).toMatch(/which product/i);
    expect(result?.events).toEqual([]);
  });
});
