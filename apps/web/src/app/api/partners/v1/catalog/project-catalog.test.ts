import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoogleMerchantListing } from '@/app/api/feed/google-merchant/feed-builder';
import { projectCatalog } from './project-catalog';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { warn } }));

const product = {
  id: 'phone',
  name: 'Phone',
  description: 'A phone',
  condition: 'open_box',
  price: 1200,
  compare_at_price: 1500,
  stock: 4,
  brand: 'Maker',
  categories: { name: 'Phones', slug: 'phones' },
} as const;

const row: GoogleMerchantListing = {
  id: 'phone-refurbished',
  product,
  title: 'Phone',
  price: 1200,
  stock: 4,
  imageUrl: 'https://example.test/image.jpg',
  url: 'https://example.test/products/phone',
};
const binding = {
  listingId: 'phone',
  productId: 'phone',
  condition: 'open_box',
} as const;

describe('CrossRem catalog projection', () => {
  beforeEach(() => warn.mockClear());

  it('pins the imported ID and publishes the exact condition and merchandise price', () => {
    expect(projectCatalog([row], [binding])).toEqual([
      {
        listing_id: 'phone',
        product_id: 'phone',
        variant_id: null,
        offer_id: null,
        title: 'Phone',
        image_url: row.imageUrl,
        product_url: row.url,
        product_type: { key: 'phones', label: 'Phones' },
        brand: 'Maker',
        condition: 'open_box',
        condition_label: 'Open Box',
        base_price_minor: 120000,
        price_minor: 127200,
        availability: 'in_stock',
        protection_included: false,
      },
    ]);
  });

  it('collects offer quantity for quoting without exposing it in the catalog', () => {
    const stockByListing = new Map<string, number>();
    const offer = {
      id: 'offer-1',
      condition: 'used' as const,
      price: 100,
      stock_quantity: 1,
    };
    const selected = projectCatalog(
      [{ ...row, id: offer.id, offer, stock: 9999 }],
      [
        {
          ...binding,
          listingId: offer.id,
          condition: 'used',
          offerId: offer.id,
        },
      ],
      stockByListing
    );

    expect(stockByListing.get(offer.id)).toBe(1);
    expect(selected[0]).toMatchObject({
      listing_id: offer.id,
      availability: 'in_stock',
    });
    expect(selected[0]).not.toHaveProperty('stock_quantity');
  });

  it('marks a listing unavailable when managed stock has run out even if legacy stock remains', () => {
    const stockByListing = new Map<string, number>();
    const selected = projectCatalog(
      [
        {
          ...row,
          product: { ...product, manage_stock: true, stock_quantity: 0 },
        },
      ],
      [binding],
      stockByListing
    );

    expect(stockByListing.get(binding.listingId)).toBe(0);
    expect(selected[0].availability).toBe('out_of_stock');
  });

  it.each([
    [99.25, 9925, 10521],
    [100.1, 10010, 10611],
  ])('adds 6% and rounds the selling price to kobo for %s', (price, base, sellingPrice) => {
    expect(projectCatalog([{ ...row, price }], [binding])[0]).toMatchObject({
      base_price_minor: base,
      price_minor: sellingPrice,
    });
  });

  it('keeps exact SKU bindings when the Google family row selects a different variant', () => {
    const variant = { id: 'black', condition: 'open_box' } as const;
    const skuRow = { ...row, id: 'phone', variant, stock: 0 };
    const skuBinding = { ...binding, variantId: 'black' };
    expect(projectCatalog([skuRow], [skuBinding])[0]).toMatchObject({
      variant_id: 'black',
      availability: 'out_of_stock',
    });
    expect(
      projectCatalog(
        [{ ...skuRow, variant: { ...variant, id: 'blue' } }],
        [skuBinding]
      )
    ).toEqual([]);
  });

  it('excludes retired bindings, ambiguous matches, and changes of condition', () => {
    expect(projectCatalog([row], [{ ...binding, retired: true }])).toEqual([]);
    expect(projectCatalog([row, { ...row, id: 'other' }], [binding])).toEqual(
      []
    );
    expect(
      projectCatalog(
        [{ ...row, product: { ...product, condition: 'refurbished' } }],
        [binding]
      )
    ).toEqual([]);
  });

  it('fills missing brand and condition from reviewed binding metadata', () => {
    const missingMetadata = {
      ...row,
      product: { ...product, brand: undefined, condition: null },
    };
    const reviewedBinding = {
      ...binding,
      condition: 'new',
      assumeNewWhenMissing: true,
      brandFallback: 'Maker',
    } as const;
    expect(
      projectCatalog([missingMetadata], [reviewedBinding])[0]
    ).toMatchObject({
      brand: 'Maker',
      condition: 'new',
      condition_label: 'New',
    });
    expect(projectCatalog([missingMetadata], [binding])).toEqual([]);
    expect(projectCatalog([row], [reviewedBinding])).toEqual([]);
    expect(
      projectCatalog([row], [{ ...binding, brandFallback: 'Other' }])[0]
    ).toMatchObject({
      brand: 'Maker',
    });
  });

  it('rejects duplicate published IDs even when one is retired', () => {
    expect(() =>
      projectCatalog(
        [row],
        [binding, { ...binding, productId: 'other', retired: true }]
      )
    ).toThrow('Duplicate CrossRem listing ID');
    expect(warn).toHaveBeenCalledExactlyOnceWith({
      message: 'Duplicate CrossRem listing ID',
      listingId: 'phone',
    });
  });

  it('rejects re-keying a retired sellable identity', () => {
    expect(() =>
      projectCatalog(
        [row],
        [
          { ...binding, retired: true },
          { ...binding, listingId: 'new-key' },
        ]
      )
    ).toThrow('Duplicate CrossRem sellable item');
    expect(warn).toHaveBeenCalledExactlyOnceWith({
      message: 'Duplicate CrossRem sellable item',
      listingId: 'new-key',
    });
  });

  it.each([
    [0, 'Invalid CrossRem merchandise price'],
    [90_000_000_000_000, 'Invalid CrossRem selling price'],
  ])('identifies the binding when the price %s cannot be exposed', (price, message) => {
    expect(() => projectCatalog([{ ...row, price }], [binding])).toThrow(
      message
    );
    expect(warn).toHaveBeenCalledExactlyOnceWith({
      message,
      listingId: 'phone',
    });
  });
});
