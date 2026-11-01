import { describe, expect, it } from 'vitest';
import type { ChatProductResult } from '@/ai/chat-product-result';
import { selectFastCatalogProducts } from './fast-catalog-eligibility';

const phone: ChatProductResult = {
  brand: 'Apple',
  category: 'Smartphones',
  description: null,
  has_variants: true,
  id: 'phone-1',
  image_url: null,
  manage_stock: false,
  name: 'iPhone 16',
  price: 100_000,
  slug: 'iphone-16',
  status: 'active',
  stock: 0,
  variant_model: 'sku_matrix',
};

const variants = [
  {
    id: 'wifi',
    product_id: 'phone-1',
    attributes: { sim_type: 'Wi-Fi Only' },
    price_override: 100_000,
    stock_quantity: 1,
  },
  {
    id: 'cellular',
    product_id: 'phone-1',
    attributes: { sim_type: 'Physical SIM' },
    price_override: 200_000,
    stock_quantity: 1,
  },
];

describe('selectFastCatalogProducts', () => {
  it('does not use a Wi-Fi-only option to satisfy an ordinary phone budget', () => {
    expect(
      selectFastCatalogProducts([phone], variants, {
        isPhoneCategory: true,
        maxPrice: 150_000,
        wifiOnly: false,
      })
    ).toEqual([]);
  });

  it('recognizes WiFi-only connectivity without confusing WiFi plus cellular', () => {
    const choices = [
      { ...variants[0], attributes: { connectivity: 'WiFi' } },
      { ...variants[1], attributes: { connectivity: 'WiFi+Cellular' } },
    ];
    expect(
      selectFastCatalogProducts([phone], choices, {
        isPhoneCategory: true,
        maxPrice: 150000,
        wifiOnly: false,
      })
    ).toEqual([]);
    expect(
      selectFastCatalogProducts([phone], choices, {
        isPhoneCategory: true,
        maxPrice: 150000,
        wifiOnly: true,
      })
    ).toEqual([phone]);
    expect(
      selectFastCatalogProducts([phone], choices, {
        isPhoneCategory: true,
        maxPrice: 250000,
        wifiOnly: false,
      })
    ).toEqual([phone]);
    const conflicting = [
      {
        ...variants[0],
        attributes: { connectivity: 'WiFi', sim_type: 'Physical SIM' },
      },
    ];
    expect(
      selectFastCatalogProducts([phone], conflicting, {
        isPhoneCategory: true,
        wifiOnly: true,
      })
    ).toEqual([]);
  });

  it('uses parent SIM specifications for a simple WiFi-only phone', () => {
    const simple = {
      ...phone,
      has_variants: false,
      variant_model: 'legacy',
      manage_stock: false,
    };
    const options = {
      isPhoneCategory: true,
      parentWifiOnlyIds: new Set([phone.id]),
    };
    expect(
      selectFastCatalogProducts([simple], [], { ...options, wifiOnly: false })
    ).toEqual([]);
    expect(
      selectFastCatalogProducts([simple], [], { ...options, wifiOnly: true })
    ).toEqual([simple]);
  });

  it('inherits a WiFi-only parent specification only when the variant has no connectivity value', () => {
    const opts = {
      isPhoneCategory: true,
      parentWifiOnlyIds: new Set([phone.id]),
      wifiOnly: true,
    };
    expect(
      selectFastCatalogProducts(
        [phone],
        [{ ...variants[0], attributes: { storage: '128 GB' } }],
        opts
      )
    ).toEqual([phone]);
    expect(
      selectFastCatalogProducts(
        [phone],
        [{ ...variants[0], attributes: { connectivity: 'WiFi+Cellular' } }],
        opts
      )
    ).toEqual([]);
    expect(
      selectFastCatalogProducts(
        [phone],
        [{ ...variants[0], attributes: { connectivity: 'WiFi+Cellular' } }],
        { ...opts, wifiOnly: false }
      )
    ).toEqual([phone]);
  });

  it('keeps a phone family when a cellular option meets the budget', () => {
    expect(
      selectFastCatalogProducts([phone], variants, {
        isPhoneCategory: true,
        maxPrice: 250_000,
        wifiOnly: false,
      })
    ).toEqual([phone]);
  });

  it('allows a Wi-Fi-only phone when the customer explicitly requests it', () => {
    expect(
      selectFastCatalogProducts([phone], variants, {
        isPhoneCategory: true,
        maxPrice: 150_000,
        wifiOnly: true,
      })
    ).toEqual([phone]);
  });

  it('does not invent eligibility when variant data is missing or belongs to another product', () => {
    expect(
      selectFastCatalogProducts(
        [phone],
        [{ ...variants[1], product_id: 'other' }],
        {
          isPhoneCategory: true,
          wifiOnly: false,
        }
      )
    ).toEqual([]);
  });

  it('does not recommend an unavailable managed product', () => {
    expect(
      selectFastCatalogProducts(
        [
          {
            ...phone,
            has_variants: false,
            variant_model: 'legacy',
            manage_stock: true,
            stock: 0,
          },
        ],
        [],
        {
          isPhoneCategory: true,
          wifiOnly: false,
        }
      )
    ).toEqual([]);
  });

  it('does not guess a selectable condition offer without its price and stock', () => {
    expect(
      selectFastCatalogProducts(
        [{ ...phone, has_condition_offers: true }],
        variants,
        {
          isPhoneCategory: true,
          maxPrice: 250_000,
          wifiOnly: false,
        }
      )
    ).toEqual([]);
  });

  it('excludes a phone explicitly named Wi-Fi only from normal recommendations', () => {
    expect(
      selectFastCatalogProducts(
        [{ ...phone, name: 'iPhone 16 Wi-Fi Only' }],
        variants,
        {
          isPhoneCategory: true,
          wifiOnly: false,
        }
      )
    ).toEqual([]);
  });

  it('distinguishes a strict upper limit from an inclusive maximum', () => {
    const options = {
      isPhoneCategory: true,
      maxPrice: 200_000,
      wifiOnly: false,
    };
    expect(
      selectFastCatalogProducts([phone], variants, {
        ...options,
        exclusiveMaxPrice: true,
      })
    ).toEqual([]);
    expect(
      selectFastCatalogProducts([phone], variants, {
        ...options,
        exclusiveMaxPrice: false,
      })
    ).toEqual([phone]);
  });
});
