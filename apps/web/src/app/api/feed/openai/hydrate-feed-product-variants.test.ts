import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenAIFeedProduct } from './feed-data';
import { hydrateOpenAIFeedProductVariants } from './hydrate-feed-product-variants';

const fetchVariants = vi.hoisted(() => vi.fn());
vi.mock('../google-merchant/fetch-feed-variants', () => ({
  fetchFeedVariants: fetchVariants,
}));
const client = {} as SupabaseClient;
const product = (): OpenAIFeedProduct => ({
  id: 'phone',
  name: 'Phone',
  description: '',
  price: 900000,
  stock: 0,
});

beforeEach(() => {
  fetchVariants.mockReset();
});

describe('hydrateOpenAIFeedProductVariants', () => {
  it('normalizes public variant facts and does not attach a foreign product row', async () => {
    fetchVariants.mockResolvedValue([
      {
        id: 'selected',
        product_id: 'phone',
        condition: 'new',
        price_override: '1200000',
        attributes: { storage: ' 256GB ', ram: 8, invalid: false, blank: ' ' },
        stock_quantity: 0,
        sku: 'PHONE-256',
      },
      {
        id: 'foreign',
        product_id: 'other-merchant-product',
        attributes: { color: 'Red' },
      },
    ]);
    const products = [product()];
    await hydrateOpenAIFeedProductVariants(client, 'merchant', products);
    expect(fetchVariants).toHaveBeenCalledWith(client, 'merchant', ['phone']);
    expect(products[0].variants).toEqual([
      {
        id: 'selected',
        attributes: { storage: '256GB', ram: '8' },
        condition: 'new',
        price_override: 1200000,
        stock_quantity: 0,
        sku: 'PHONE-256',
      },
    ]);
  });

  it('retains unknown facts as unknown rather than inventing stock, prices or conditions', async () => {
    fetchVariants.mockResolvedValue([
      {
        id: 'unknown',
        product_id: 'phone',
        attributes: null,
        price_override: 'invalid',
        stock_quantity: null,
        sku: null,
      },
    ]);
    const products = [product()];
    await hydrateOpenAIFeedProductVariants(client, 'merchant', products);
    expect(products[0].variants).toEqual([
      {
        id: 'unknown',
        attributes: {},
        condition: undefined,
        price_override: undefined,
        stock_quantity: undefined,
        sku: undefined,
      },
    ]);
  });

  it('clears stale embedded variants when the public projection returns none', async () => {
    fetchVariants.mockResolvedValue([]);
    const products = [
      { ...product(), variants: [{ id: 'stale', attributes: {} }] },
    ];
    await hydrateOpenAIFeedProductVariants(client, 'merchant', products);
    expect(products[0].variants).toEqual([]);
  });

  it('propagates the public RPC failure rather than silently publishing family-only rows', async () => {
    fetchVariants.mockRejectedValue(
      new Error('Failed to fetch product variants')
    );
    await expect(
      hydrateOpenAIFeedProductVariants(client, 'merchant', [product()])
    ).rejects.toThrow('Failed to fetch product variants');
  });
});
