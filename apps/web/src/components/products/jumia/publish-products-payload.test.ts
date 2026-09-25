import { describe, expect, it } from 'vitest';
import {
  buildJumiaPublishPayload,
  getJumiaPublishBlockReason,
} from './publish-products-payload';

describe('buildJumiaPublishPayload', () => {
  it('maps product and variant inventory into a Jumia feed payload', () => {
    const payload = buildJumiaPublishPayload(
      {
        id: 'prod-1',
        name: '<b>Phone</b>',
        description: 'A phone',
        sku: 'PARENT',
        price: 100,
        image: 'https://cdn.example.com/phone.jpg',
        variants: [{ sku: 'SKU-1', price_override: 120, stock_quantity: 3 }],
      },
      'integration-1',
      42,
      { code: 1, name: 'Generic' },
      'GHS'
    );
    expect(payload).toMatchObject({
      integrationId: 'integration-1',
      productId: 'prod-1',
      name: 'Phone',
      category: { code: 42 },
      images: [{ url: 'https://cdn.example.com/phone.jpg', primary: true }],
      variations: [
        { sellerSku: 'SKU-1', price: 120, stock: 3, currency: 'GHS' },
      ],
    });
  });

  it('omits catalog placeholder images from the publish payload', () => {
    const payload = buildJumiaPublishPayload(
      {
        id: 'prod-1',
        name: 'Phone',
        sku: 'SKU-1',
        price: 100,
        image: '/placeholder.png',
      },
      'integration-1',
      42,
      { code: 1, name: 'Generic' },
      'NGN'
    );

    expect(payload.images).toEqual([]);
  });

  it('maps legacy string image entries into the Jumia feed payload', () => {
    const payload = buildJumiaPublishPayload(
      {
        id: 'prod-1',
        name: 'Phone',
        sku: 'SKU-1',
        price: 100,
        images: [
          'https://cdn.example.com/legacy.jpg',
          { url: 'https://cdn.example.com/object.jpg' },
        ],
      },
      'integration-1',
      42,
      { code: 1, name: 'Generic' },
      'NGN'
    );

    expect(payload.images).toEqual([
      { url: 'https://cdn.example.com/legacy.jpg', primary: true },
      { url: 'https://cdn.example.com/object.jpg', primary: false },
    ]);
  });
});

describe('getJumiaPublishBlockReason', () => {
  it('blocks zero-priced products before submission', () => {
    expect(
      getJumiaPublishBlockReason({
        id: 'prod-1',
        name: 'Freebie',
        sku: 'SKU-1',
        price: 0,
        image: 'https://cdn.example.com/freebie.jpg',
      })
    ).toBe('Set a price greater than zero before submitting to Jumia.');
  });

  it('ignores inventory-anchor variants when evaluating publish readiness', () => {
    expect(
      getJumiaPublishBlockReason({
        id: 'prod-1',
        name: 'Phone',
        sku: 'PHONE-1',
        price: 100,
        image: 'https://cdn.example.com/phone.jpg',
        variants: [
          {
            sku: 'PHONE-1',
            price_override: 0,
            stock_quantity: 5,
            is_inventory_anchor: true,
          },
        ],
      })
    ).toBeNull();
  });

  it('blocks non-anchor sellable variants with zero price overrides', () => {
    expect(
      getJumiaPublishBlockReason({
        id: 'prod-1',
        name: 'Phone',
        sku: 'PHONE-1',
        price: 100,
        image: 'https://cdn.example.com/phone.jpg',
        variants: [
          {
            sku: 'PHONE-RED',
            price_override: 0,
            stock_quantity: 5,
          },
        ],
      })
    ).toBe('Set a price greater than zero before submitting to Jumia.');
  });

  it('blocks products that only have the catalog placeholder image', () => {
    expect(
      getJumiaPublishBlockReason({
        id: 'prod-1',
        name: 'Phone',
        sku: 'SKU-1',
        price: 100,
        image: '/placeholder.png',
      })
    ).toBe('Upload a product image before submitting to Jumia.');
  });

  it('blocks variant products when any non-anchor variant is missing a SKU', () => {
    expect(
      getJumiaPublishBlockReason({
        id: 'prod-1',
        name: 'Phone',
        sku: 'PHONE-PARENT',
        price: 100,
        image: 'https://cdn.example.com/phone.jpg',
        variants: [
          { sku: 'PHONE-RED', price_override: 100, stock_quantity: 2 },
          { sku: '', price_override: 100, stock_quantity: 1 },
        ],
      })
    ).toBe('Add a SKU for every variant before submitting to Jumia.');
  });
});
