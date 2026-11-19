import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/products';
import {
  getInitialCriticalVariantSelection,
  getInitialCriticalVariantSelectionPrimaryImage,
  resolveServerPdpRouteSelectionStatus,
  shouldRedirectVariantSelectionParams,
} from './critical-variant-selection';

const variantProduct = {
  condition: 'used',
  has_variants: true,
  id: 'prod-1',
  manage_stock: true,
  offers: [
    {
      condition: 'used',
      id: 'offer-used-1',
      price: 700000,
      stock_quantity: 2,
    },
  ],
  price: 800000,
  variants: [
    {
      attributes: { storage: '128GB' },
      condition: 'used',
      id: 'variant-used-128',
      price_override: 750000,
      primary_image: 'https://cdn.example.com/used.avif',
      stock_quantity: 3,
    },
    {
      attributes: { storage: '128GB' },
      condition: 'open_box',
      id: 'variant-open-box-128',
      price_override: 650000,
      primary_image: 'https://cdn.example.com/open-box.avif',
      stock_quantity: 3,
    },
  ],
} as unknown as Product;

const variantlessProduct = {
  condition: 'new',
  has_variants: false,
  id: 'prod-simple',
  manage_stock: true,
  offers: [
    {
      condition: 'used',
      id: 'offer-used-simple',
      price: 450000,
      stock_quantity: 1,
    },
  ],
  price: 500000,
  variants: [],
} as unknown as Product;

describe('critical variant selection helpers', () => {
  it('opens ordinary phone pages on the eligible cellular variant and preserves an explicit restricted selection', () => {
    const product = {
      ...variantProduct,
      name: 'iPhone 16',
      variants: [
        {
          ...variantProduct.variants?.[0],
          id: 'wifi',
          attributes: { sim_type: 'Wi-Fi Only' },
          price_override: 600000,
        },
        {
          ...variantProduct.variants?.[1],
          id: 'cellular',
          attributes: { sim_type: 'Physical + eSIM' },
          price_override: 900000,
        },
      ],
    } as Product;
    expect(getInitialCriticalVariantSelection(product, {})).toHaveProperty(
      'variantId',
      'cellular'
    );
    expect(
      getInitialCriticalVariantSelection(product, { variantId: 'wifi' })
    ).toHaveProperty('variantId', 'wifi');
  });

  it('uses the global lowest-priced variant for no-query critical defaults', () => {
    expect(getInitialCriticalVariantSelection(variantProduct, {})).toEqual({
      attributes: { storage: '128GB' },
      variantId: 'variant-open-box-128',
    });
  });

  it('resolves the initial critical selection primary image from primary_image', () => {
    const selection = getInitialCriticalVariantSelection(variantProduct, {});

    expect(
      getInitialCriticalVariantSelectionPrimaryImage(variantProduct, selection)
    ).toBe('https://cdn.example.com/open-box.avif');
  });

  it('flags ambiguous attribute-only route selections for redirect', () => {
    expect(
      shouldRedirectVariantSelectionParams(variantProduct, { storage: '128GB' })
    ).toBe(true);
  });

  it('does not redirect an unknown exact variant id (client shows missing)', () => {
    expect(
      shouldRedirectVariantSelectionParams(variantProduct, {
        variant_id: 'variant-gone',
      })
    ).toBe(false);
  });

  describe('resolveServerPdpRouteSelectionStatus', () => {
    it('returns hasMissingRouteSelection: false for a valid variant_id', () => {
      expect(
        resolveServerPdpRouteSelectionStatus({
          product: variantProduct,
          offers: variantProduct.offers,
          searchParams: { variant_id: 'variant-used-128' },
        })
      ).toEqual({
        missingVariantId: false,
        missingOfferId: false,
        hasMissingRouteSelection: false,
      });
    });

    it('returns missingVariantId: true and hasMissingRouteSelection: true for an unknown variant_id on a product with variants', () => {
      expect(
        resolveServerPdpRouteSelectionStatus({
          product: variantProduct,
          offers: variantProduct.offers,
          searchParams: { variant_id: 'variant-gone' },
        })
      ).toEqual({
        missingVariantId: true,
        missingOfferId: false,
        hasMissingRouteSelection: true,
      });
    });

    it('returns missingVariantId: true and hasMissingRouteSelection: true when variant_id is supplied to a product without variants', () => {
      expect(
        resolveServerPdpRouteSelectionStatus({
          product: variantlessProduct,
          offers: variantlessProduct.offers,
          searchParams: { variant_id: 'any-variant-id' },
        })
      ).toEqual({
        missingVariantId: true,
        missingOfferId: false,
        hasMissingRouteSelection: true,
      });
    });

    it('returns hasMissingRouteSelection: false for a valid offer_id', () => {
      expect(
        resolveServerPdpRouteSelectionStatus({
          product: variantProduct,
          offers: variantProduct.offers,
          searchParams: { offer_id: 'offer-used-1' },
        })
      ).toEqual({
        missingVariantId: false,
        missingOfferId: false,
        hasMissingRouteSelection: false,
      });
    });

    it('returns missingOfferId: true and hasMissingRouteSelection: true for an unknown offer_id', () => {
      expect(
        resolveServerPdpRouteSelectionStatus({
          product: variantProduct,
          offers: variantProduct.offers,
          searchParams: { offer_id: 'offer-gone' },
        })
      ).toEqual({
        missingVariantId: false,
        missingOfferId: true,
        hasMissingRouteSelection: true,
      });
    });

    it('returns hasMissingRouteSelection: false for a clean URL or match_base=1', () => {
      expect(
        resolveServerPdpRouteSelectionStatus({
          product: variantProduct,
          offers: variantProduct.offers,
          searchParams: {},
        })
      ).toEqual({
        missingVariantId: false,
        missingOfferId: false,
        hasMissingRouteSelection: false,
      });

      expect(
        resolveServerPdpRouteSelectionStatus({
          product: variantProduct,
          offers: variantProduct.offers,
          searchParams: { match_base: '1', condition: 'used' },
        })
      ).toEqual({
        missingVariantId: false,
        missingOfferId: false,
        hasMissingRouteSelection: false,
      });
    });
  });
});
