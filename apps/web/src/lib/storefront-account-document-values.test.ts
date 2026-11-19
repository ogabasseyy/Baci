import { describe, expect, it } from 'vitest';
import {
  asNumber,
  asString,
  buildCustomerAddress,
  buildOrderItems,
  normalizeShippingAddress,
} from '@/lib/storefront-account-document-values';

describe('storefront account document values', () => {
  it('normalizes shipping address records and strings', () => {
    expect(normalizeShippingAddress('12 Allen Avenue')).toEqual({
      address_line1: '12 Allen Avenue',
    });
    expect(normalizeShippingAddress('')).toBeNull();
    expect(normalizeShippingAddress(undefined)).toBeNull();

    expect(
      normalizeShippingAddress({
        street: '12 Allen Avenue',
        city: 'Lagos',
        state: 'Lagos',
        postal_code: '100001',
        country: 'NG',
      })
    ).toEqual({
      address_line1: '12 Allen Avenue',
      address_line2: '',
      city: 'Lagos',
      state: 'Lagos',
      postal_code: '100001',
      country: 'NG',
    });
  });

  it('coerces numeric values with asNumber', () => {
    expect(asNumber('1200')).toBe(1200);
    expect(asNumber(null)).toBe(0);
    expect(asNumber(undefined)).toBe(0);
  });

  it('coerces non-string values with asString', () => {
    expect(asString(42)).toBe('');
    expect(asString(null)).toBe('');
    expect(asString(undefined)).toBe('');
  });

  it('builds customer addresses with and without address line 2', () => {
    expect(
      buildCustomerAddress({
        address_line1: '12 Allen Avenue',
        address_line2: 'Suite 4',
        city: 'Lagos',
        state: 'Lagos',
        postal_code: '100001',
        country: 'NG',
      })
    ).toEqual({
      street: '12 Allen Avenue, Suite 4',
      city: 'Lagos',
      state: 'Lagos',
      postal_code: '100001',
      country: 'NG',
    });
    expect(
      buildCustomerAddress({
        address_line1: '12 Allen Avenue',
        address_line2: '',
        city: 'Lagos',
        state: 'Lagos',
        postal_code: '100001',
        country: 'NG',
      })
    ).toEqual({
      street: '12 Allen Avenue',
      city: 'Lagos',
      state: 'Lagos',
      postal_code: '100001',
      country: 'NG',
    });
  });

  it('normalizes order items for document builders', () => {
    expect(buildOrderItems([])).toEqual([]);
    expect(
      buildOrderItems([
        {
          id: 'item-1',
          product_id: null,
          variant_id: 'variant-1',
          variant_name: 'Blue / 128GB',
          condition: 'open_box',
          name: 'iPhone 16',
          quantity: 2,
          price: 1000,
        },
      ])
    ).toEqual([
      expect.objectContaining({
        id: 'item-1',
        product_id: '',
        variant_id: 'variant-1',
        condition: 'open_box',
        variant_name: 'Blue / 128GB, Open Box',
        name: 'iPhone 16',
        product_name: 'iPhone 16',
        quantity: 2,
        price: 1000,
      }),
    ]);
  });

  it('falls back to canonical condition labels for receipt item variants', () => {
    expect(
      buildOrderItems([
        {
          id: 'item-used',
          product_id: 'prod-used',
          variant_id: null,
          condition: 'used',
          variant_name: null,
          name: 'Samsung Galaxy Fold 5',
          quantity: 1,
          price: 930000,
        },
        {
          id: 'item-open-box',
          product_id: 'prod-open-box',
          variant_id: null,
          condition: 'open_box',
          variant_name: null,
          name: 'Samsung Galaxy S24 Ultra',
          quantity: 1,
          price: 1250000,
        },
      ]).map((item) => item.variant_name)
    ).toEqual(['Used', 'Open Box']);
  });

  it('combines explicit item variants with canonical condition labels', () => {
    expect(
      buildOrderItems([
        {
          id: 'item-storage',
          product_id: 'prod-storage',
          variant_id: 'variant-storage',
          condition: 'used',
          variant_name: 'Black / 512GB',
          name: 'Samsung Galaxy Z Fold 5',
          quantity: 1,
          price: 930000,
        },
        {
          id: 'item-condition-in-name',
          product_id: 'prod-condition-in-name',
          variant_id: 'variant-condition-in-name',
          condition: 'used',
          variant_name: 'Used',
          name: 'Samsung Galaxy Fold 5',
          quantity: 1,
          price: 930000,
        },
        {
          id: 'item-imported-condition-name',
          product_id: 'prod-imported-condition-name',
          variant_id: null,
          condition: 'used',
          variant_name: null,
          name: 'Samsung Galaxy Fold 5 (Premium Used)',
          quantity: 1,
          price: 930000,
        },
        {
          id: 'item-condition-word-in-title',
          product_id: 'prod-condition-word-in-title',
          variant_id: null,
          condition: 'new',
          variant_name: null,
          name: 'New Age Charger',
          quantity: 1,
          price: 25000,
        },
        {
          id: 'item-non-condition-bracket',
          product_id: 'prod-non-condition-bracket',
          variant_id: null,
          condition: 'new',
          variant_name: null,
          name: 'Samsung Galaxy S23 [New Screen]',
          quantity: 1,
          price: 540000,
        },
        {
          id: 'item-exact-bracketed-condition',
          product_id: 'prod-exact-bracketed-condition',
          variant_id: null,
          condition: 'new',
          variant_name: null,
          name: 'Samsung Galaxy S23 [New]',
          quantity: 1,
          price: 540000,
        },
      ]).map((item) => item.variant_name)
    ).toEqual([
      'Black / 512GB, Used',
      'Used',
      undefined,
      'New',
      'New',
      undefined,
    ]);
  });

  it('throws when an order item has invalid quantity or price data', () => {
    expect(() =>
      buildOrderItems([
        {
          id: 'item-2',
          product_id: 'prod-2',
          variant_id: null,
          variant_name: null,
          name: 'MacBook Air',
          quantity: null,
          price: '500' as never,
        },
      ])
    ).toThrow('Invalid order item quantity for item item-2');

    expect(() =>
      buildOrderItems([
        {
          id: 'item-3',
          product_id: 'prod-3',
          variant_id: null,
          variant_name: null,
          name: 'iPad Pro',
          quantity: 1,
          price: '' as never,
        },
      ])
    ).toThrow('Invalid order item price for item item-3');
  });

  it('carries stored line ids for fulfillment matching', () => {
    const [first, second] = buildOrderItems([
      {
        id: 'item-5',
        line_id: 5,
        product_id: 'prod-5',
        variant_id: null,
        variant_name: null,
        name: 'Widget',
        quantity: 1,
        price: 50,
      },
      {
        id: 'item-2',
        line_id: null,
        product_id: 'prod-2',
        variant_id: null,
        variant_name: null,
        name: 'Gadget',
        quantity: 1,
        price: 25,
      },
    ]);

    expect(first?.line_id).toBe(5);
    expect(second?.line_id).toBeUndefined();
  });
});
