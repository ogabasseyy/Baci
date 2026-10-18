import { describe, expect, it, vi } from 'vitest';
import { mcpCatalogRenderInputSchema as catalogRenderInputSchema } from '../src/schemas/mcp-catalog-render';
import { createCatalogRenderer } from './create-catalog-renderer';
import { createSearchProductsToolConfig } from './search-products-tool-config';

describe('decoupled catalog rendering', () => {
  it('search returns data without launching a widget', () => {
    const config = createSearchProductsToolConfig('ui://legacy.html');
    expect(config._meta).not.toHaveProperty('openai/outputTemplate');
    expect(config._meta).not.toHaveProperty('ui.resourceUri');
  });
  it('fetches selected IDs once, preserves order and never accepts supplied prices', async () => {
    const lookup = vi.fn(async (id: string) => ({
      structuredContent: {
        products: [
          {
            id,
            name: id,
            price: 10,
            condition: 'new',
            in_stock: true,
            stock_level: 'available',
            stock_confidence: 'high',
          },
        ],
      },
    }));
    const render = createCatalogRenderer(lookup);
    const result = await render({ products: [{ product_id: 'second' }, { product_id: 'first' }, { product_id: 'second' }] });
    expect(lookup.mock.calls.map(([id]) => id)).toEqual(['second', 'first']);
    expect(result.structuredContent.products.map((p) => p.id)).toEqual([
      'second',
      'first',
    ]);
    expect(
      catalogRenderInputSchema.safeParse({
        products: [{ product_id: 'first' }],
        product_ids: ['first'],
      }).success
    ).toBe(false);
  });
  it('fails closed when any lookup fails instead of presenting a partial comparison', async () => {
    const render = createCatalogRenderer(async () => {
      throw new Error('private database details');
    });
    const result = await render({ products: [{ product_id: 'missing' }] });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.products).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('private database');
  });
  it('rejects empty and oversized selections', () => {
    expect(
      catalogRenderInputSchema.safeParse({ products: [] }).success
    ).toBe(false);
    expect(
      catalogRenderInputSchema.safeParse({ products: Array(21).fill({ product_id: 'id' }) })
        .success
    ).toBe(false);
  });
});

it('does not render an unconfirmed price as a zero-priced product', async () => {
  const render = createCatalogRenderer(async () => ({
    structuredContent: {
      products: [
        {
          id: 'phone',
          name: 'Phone',
          price: null,
          condition: 'new',
          in_stock: null,
          stock_level: 'Unconfirmed',
          stock_confidence: 'unconfirmed',
        },
      ],
    },
  }));
  expect((await render({ products: [{ product_id: 'phone' }] })).isError).toBe(true);
});

it.each([
  'variant_lookup_failed',
  'offer_lookup_failed',
])('rejects unverified option data when %s', async (flag) => {
  const render = createCatalogRenderer(async () => ({
    structuredContent: {
      products: [
        {
          id: 'phone',
          name: 'Phone',
          price: 10,
          condition: 'new',
          in_stock: true,
          stock_level: 'available',
          stock_confidence: 'high',
        },
      ],
      [flag]: true,
    },
  }));
  const result = await render({ products: [{ product_id: 'phone' }] });
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    status: 'unavailable',
    products: [],
    message: expect.stringContaining('Search again'),
  });
});

it('revalidates a matched variant and renders its authoritative price and selection URL', async () => {
  const render = createCatalogRenderer(async () => ({
    structuredContent: {
      products: [{
        id: 'phone', name: 'Phone', slug: 'phone', price: 100, condition: 'new',
        in_stock: true, stock_level: 'available', stock_confidence: 'high', has_variants: true,
      }],
      variants: [{ option_id: 'variant-7', attributes: { storage: '256GB' }, price: 125, stock: 2, availability: 'in_stock', condition: 'new' }],
    },
  }));
  const result = await render({ products: [{
    product_id: 'phone',
    matched_option: { kind: 'variant', option_id: 'variant-7', condition: 'new' },
  }] });
  expect(result.structuredContent.products[0]).toMatchObject({
    price: 125,
    condition: 'new',
    url: 'https://ogabassey.com/products/phone?condition=new&variantId=variant-7',
  });
});

it('fails closed when the searched option no longer exists', async () => {
  const render = createCatalogRenderer(async () => ({
    structuredContent: {
      products: [{ id: 'phone', name: 'Phone', price: 100, condition: 'new', in_stock: true, stock_level: 'available', stock_confidence: 'high', has_variants: true }],
      variants: [],
    },
  }));
  const result = await render({ products: [{
    product_id: 'phone',
    matched_option: { kind: 'variant', option_id: 'stale-variant', condition: 'new' },
  }] });
  expect(result.isError).toBe(true);
  expect(result.structuredContent.products).toEqual([]);
});

it('uses the authoritative offer price for a selected condition', async () => {
  const render = createCatalogRenderer(async () => ({
    structuredContent: {
      products: [{ id: 'phone', name: 'Phone', slug: 'phone', price: 80, base_price: 100, base_condition: 'new', condition: 'used', in_stock: true, stock_level: 'available', stock_confidence: 'high', has_condition_offers: true }],
      condition_offers: [{ offer_id: 'offer-2', condition: 'used', price: 80, stock_quantity: 1, availability: 'in_stock' }],
    },
  }));
  const result = await render({ products: [{
    product_id: 'phone',
    matched_option: { kind: 'offer', option_id: 'offer-2', condition: 'used' },
  }] });
  expect(result.structuredContent.products[0]).toMatchObject({
    price: 80,
    condition: 'used',
    in_stock: true,
    url: 'https://ogabassey.com/products/phone?condition=used',
  });
});

it('uses paired variant price and stock when the selected offer is out of stock', async () => {
  const render = createCatalogRenderer(async () => ({
    structuredContent: {
      products: [{ id: 'phone', name: 'Phone', slug: 'phone', price: 100, base_price: 100, base_condition: 'new', condition: 'used', in_stock: true, stock_level: 'available', stock_confidence: 'high', has_variants: true, has_condition_offers: true }],
      variants: [{ option_id: 'variant-7', attributes: { storage: '256GB' }, price: 125, stock: 2, availability: 'in_stock', condition: 'new' }],
      condition_offers: [{ offer_id: 'offer-2', condition: 'used', price: 80, stock_quantity: 0, availability: 'out_of_stock' }],
    },
  }));
  const result = await render({ products: [{
    product_id: 'phone',
    matched_option: { kind: 'offer', option_id: 'offer-2', variantId: 'variant-7', condition: 'used' },
  }] });
  expect(result.structuredContent.products[0]).toMatchObject({
    price: 125,
    condition: 'used',
    in_stock: true,
    url: 'https://ogabassey.com/products/phone?condition=used&variantId=variant-7',
  });
});

it('does not use a cheapest offer summary price for a selected base option', async () => {
  const render = createCatalogRenderer(async () => ({
    structuredContent: {
      products: [{ id: 'phone', name: 'Phone', slug: 'phone', price: 80, base_price: 100, base_condition: 'new', condition: 'used', in_stock: true, stock_level: 'available', stock_confidence: 'high', has_condition_offers: true }],
      condition_offers: [{ offer_id: 'offer-2', condition: 'used', price: 80, stock_quantity: 1, availability: 'in_stock' }],
    },
  }));
  const result = await render({ products: [{
    product_id: 'phone',
    matched_option: { kind: 'base', condition: 'new' },
  }] });
  expect(result.structuredContent.products[0]).toMatchObject({ price: 100, condition: 'new' });
});

it('bounds concurrent product lookups', async () => {
  let active = 0;
  let maximum = 0;
  const render = createCatalogRenderer(async (id) => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    return { structuredContent: { products: [{ id, name: id, price: 1, condition: 'new', in_stock: true, stock_level: 'available', stock_confidence: 'high' }] } };
  });
  await render({ products: Array.from({ length: 20 }, (_, index) => ({ product_id: `p-${index}` })) });
  expect(maximum).toBeLessThanOrEqual(4);
});
