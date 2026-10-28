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
