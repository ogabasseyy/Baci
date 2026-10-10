import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareCartValidationItems } from './prepare-cart-validation-items';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const VARIANT_ID = '33333333-3333-4333-8333-333333333333';
const OFFER_ID = '55555555-5555-4555-8555-555555555555';

describe('prepareCartValidationItems', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes cart items and partitions queryable ids', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const prepared = prepareCartValidationItems(
      [
        {
          id: PRODUCT_ID,
          price: 400_000,
          variant_id: VARIANT_ID,
          offerId: OFFER_ID,
        },
        { id: 'not-a-uuid', price: 10 },
      ],
      undefined
    );

    expect(prepared.validationItems).toEqual([
      {
        id: PRODUCT_ID,
        price: 400_000,
        variantId: VARIANT_ID,
        offerId: OFFER_ID,
      },
      {
        id: 'not-a-uuid',
        price: 10,
        variantId: undefined,
        offerId: undefined,
      },
    ]);
    expect(prepared.validFormatIds).toEqual([PRODUCT_ID]);
    expect(prepared.invalidFormatIds).toEqual(['not-a-uuid']);
    expect(prepared.validVariantIds).toEqual([VARIANT_ID]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('falls back to product ids when no cart items are sent', () => {
    const prepared = prepareCartValidationItems([], [PRODUCT_ID]);

    expect(prepared.validationItems).toEqual([{ id: PRODUCT_ID, price: null }]);
    expect(prepared.validFormatIds).toEqual([PRODUCT_ID]);
    expect(prepared.invalidFormatIds).toEqual([]);
    expect(prepared.validVariantIds).toEqual([]);
  });
});
