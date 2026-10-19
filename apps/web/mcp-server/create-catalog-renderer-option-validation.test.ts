import { expect, it } from 'vitest';
import { createCatalogRenderer } from './create-catalog-renderer';

it('accepts search matched_option facts but renders only freshly looked-up values', async () => {
  const render = createCatalogRenderer(async () => ({
    structuredContent: {
      products: [{
        id: 'phone', name: 'Phone', slug: 'phone', price: 100, condition: 'new',
        in_stock: true, stock_level: 'available', stock_confidence: 'high', has_variants: true,
      }],
      variants: [{ option_id: 'variant-7', attributes: { storage: '256GB' }, price: 125, availability: 'in_stock', condition: 'new' }],
    },
  }));
  const result = await render({ products: [{
    product_id: 'phone',
    matched_option: {
      kind: 'variant', option_id: 'variant-7', condition: 'new',
      price: 1, attributes: { storage: 'caller-controlled' },
    },
  }] });
  expect(result.structuredContent.products[0]).toMatchObject({ price: 125 });
  expect(result.structuredContent.products[0].url).toContain('variantId=variant-7');
});

it('rejects an offer that duplicates the parent condition', async () => {
  const render = createCatalogRenderer(async () => ({
    structuredContent: {
      products: [{ id: 'phone', name: 'Phone', price: 100, condition: 'new', in_stock: true, stock_level: 'available', stock_confidence: 'high', has_condition_offers: true }],
      condition_offers: [{ offer_id: 'offer-1', condition: 'new', price: 90, availability: 'in_stock' }],
    },
  }));
  const result = await render({ products: [{
    product_id: 'phone', matched_option: { kind: 'offer', option_id: 'offer-1', condition: 'new' },
  }] });
  expect(result.isError).toBe(true);
});

it('compares an offer against base_condition when product.condition summarizes another offer', async () => {
  const render = createCatalogRenderer(async () => ({
    structuredContent: {
      products: [{
        id: 'phone', name: 'Phone', price: 80, base_price: 100,
        condition: 'used', base_condition: 'new', in_stock: true,
        stock_level: 'available', stock_confidence: 'high', has_condition_offers: true,
      }],
      condition_offers: [{ offer_id: 'used-offer', condition: 'used', price: 80, stock_quantity: 1, availability: 'in_stock' }],
    },
  }));
  const result = await render({ products: [{
    product_id: 'phone', matched_option: { kind: 'offer', option_id: 'used-offer', condition: 'used' },
  }] });
  expect(result.isError).toBeUndefined();
  expect(result.structuredContent.products[0]).toMatchObject({ price: 80, condition: 'used' });
});

it('rejects a later offer when an earlier row owns the same canonical condition', async () => {
  const render = createCatalogRenderer(async () => ({
    structuredContent: {
      products: [{ id: 'phone', name: 'Phone', price: 100, condition: 'new', in_stock: true, stock_level: 'available', stock_confidence: 'high', has_condition_offers: true }],
      condition_offers: [
        { offer_id: 'first', condition: 'refurbished', price: 90, availability: 'in_stock' },
        { offer_id: 'later', condition: 'open_box', price: 80, availability: 'in_stock' },
      ],
    },
  }));
  const result = await render({ products: [{
    product_id: 'phone', matched_option: { kind: 'offer', option_id: 'later', condition: 'open_box' },
  }] });
  expect(result.isError).toBe(true);
});

it('rejects unknown condition labels instead of treating them as new', async () => {
  const render = createCatalogRenderer(async () => ({
    structuredContent: {
      products: [{ id: 'phone', name: 'Phone', price: 100, condition: 'new', in_stock: true, stock_level: 'available', stock_confidence: 'high', has_condition_offers: true }],
      condition_offers: [{ offer_id: 'offer-1', condition: 'new', price: 90, availability: 'in_stock' }],
    },
  }));
  const result = await render({ products: [{
    product_id: 'phone', matched_option: { kind: 'offer', option_id: 'offer-1', condition: 'banana' },
  }] });
  expect(result.isError).toBe(true);
});

it('rejects an unpaired offer on a variant product', async () => {
  const render = createCatalogRenderer(async () => ({
    structuredContent: {
      products: [{ id: 'phone', name: 'Phone', price: 125, base_price: 125, base_condition: 'new', condition: 'new', in_stock: true, stock_level: 'available', stock_confidence: 'high', has_variants: true, has_condition_offers: true }],
      variants: [{ option_id: 'variant-7', attributes: { storage: '256GB' }, price: 125, availability: 'in_stock', condition: null }],
      condition_offers: [{ offer_id: 'offer-2', condition: 'used', price: 80, stock_quantity: 1, availability: 'in_stock' }],
    },
  }));
  const result = await render({ products: [{
    product_id: 'phone', matched_option: { kind: 'offer', option_id: 'offer-2', condition: 'used' },
  }] });
  expect(result.isError).toBe(true);
});

it('falls back to the parent comparison price for a paired offer without a variant comparison price', async () => {
  const render = createCatalogRenderer(async () => ({
    structuredContent: {
      products: [{ id: 'phone', name: 'Phone', price: 125, base_price: 125, base_condition: 'new', compare_at_price: 150, condition: 'new', in_stock: true, stock_level: 'available', stock_confidence: 'high', has_variants: true, has_condition_offers: true }],
      variants: [{ option_id: 'variant-7', attributes: { storage: '256GB' }, price: 125, availability: 'in_stock', condition: null }],
      condition_offers: [{ offer_id: 'offer-2', condition: 'used', price: 80, stock_quantity: 1, availability: 'in_stock' }],
    },
  }));
  const result = await render({ products: [{
    product_id: 'phone', matched_option: { kind: 'offer', option_id: 'offer-2', variantId: 'variant-7', condition: 'used' },
  }] });
  expect(result.structuredContent.products[0]).toMatchObject({ price: 125, compare_at_price: 150 });
});

it('rejects a variant selection whose caller variantId conflicts with its option_id', async () => {
  const render = createCatalogRenderer(async () => ({
    structuredContent: {
      products: [{ id: 'phone', name: 'Phone', price: 125, condition: 'new', in_stock: true, stock_level: 'available', stock_confidence: 'high', has_variants: true }],
      variants: [
        { option_id: 'v1', attributes: { storage: '128GB' }, price: 100, availability: 'in_stock', condition: null },
        { option_id: 'v2', attributes: { storage: '256GB' }, price: 125, availability: 'in_stock', condition: null },
      ],
    },
  }));
  const result = await render({ products: [{
    product_id: 'phone', matched_option: { kind: 'variant', option_id: 'v1', variantId: 'v2', condition: 'new' },
  }] });
  expect(result.isError).toBe(true);
  expect(result.structuredContent.products).toEqual([]);
});

it('accepts a variant selection that echoes its option_id as variantId', async () => {
  const render = createCatalogRenderer(async () => ({
    structuredContent: {
      products: [{ id: 'phone', name: 'Phone', slug: 'phone', price: 125, condition: 'new', in_stock: true, stock_level: 'available', stock_confidence: 'high', has_variants: true }],
      variants: [{ option_id: 'v1', attributes: { storage: '128GB' }, price: 100, availability: 'in_stock', condition: null }],
    },
  }));
  const result = await render({ products: [{
    product_id: 'phone', matched_option: { kind: 'variant', option_id: 'v1', variantId: 'v1', condition: 'new' },
  }] });
  expect(result.structuredContent.products[0]).toMatchObject({
    price: 100,
    url: 'https://ogabassey.com/products/phone?condition=new&variantId=v1',
  });
});
