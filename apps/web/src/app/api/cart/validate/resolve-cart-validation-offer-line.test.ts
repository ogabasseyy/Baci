import { describe, expect, it } from 'vitest';
import {
  buildSimpleProductQuantityTotals,
  getCartValidationKey,
  getInvalidOfferLineKey,
  isOfferParentEligible,
  readSimpleProductQuantityTotal,
  resolveReportedLineStock,
} from './resolve-cart-validation-offer-line';

const STR_ID = '11111111-1111-4111-8111-111111111111';
const OFFER_ID = '55555555-5555-4555-8555-555555555555';

const ELIGIBLE_PARENT = {
  has_condition_offers: true,
  has_variants: false,
  variant_model: null,
};

describe('getCartValidationKey', () => {
  it('builds product, variant, and offer keys', () => {
    expect(getCartValidationKey(STR_ID)).toBe(STR_ID);
    expect(getCartValidationKey(STR_ID, 'v1')).toBe(`${STR_ID}::v1`);
    expect(getCartValidationKey(STR_ID, undefined, OFFER_ID)).toBe(
      `${STR_ID}::offer=${OFFER_ID}`
    );
  });
});

describe('isOfferParentEligible', () => {
  it('accepts a flagged non-variant parent without live variants', () => {
    expect(isOfferParentEligible(ELIGIBLE_PARENT, false)).toBe(true);
  });

  it.each([
    {
      name: 'flag off',
      flags: { ...ELIGIBLE_PARENT, has_condition_offers: false },
      hasLiveVariants: false,
    },
    {
      name: 'flag null',
      flags: { ...ELIGIBLE_PARENT, has_condition_offers: null },
      hasLiveVariants: false,
    },
    {
      name: 'variant bearing',
      flags: { ...ELIGIBLE_PARENT, has_variants: true },
      hasLiveVariants: false,
    },
    {
      name: 'sku matrix',
      flags: { ...ELIGIBLE_PARENT, variant_model: 'sku_matrix' },
      hasLiveVariants: false,
    },
    {
      name: 'live variants',
      flags: ELIGIBLE_PARENT,
      hasLiveVariants: true,
    },
  ])('rejects a parent with $name', ({ flags, hasLiveVariants }) => {
    expect(isOfferParentEligible(flags, hasLiveVariants)).toBe(false);
  });
});

describe('getInvalidOfferLineKey', () => {
  it('passes non-offer lines', () => {
    expect(
      getInvalidOfferLineKey({
        strId: STR_ID,
        offer: undefined,
        parentEligible: false,
      })
    ).toBeNull();
  });

  it('passes a live offer on an eligible parent with matching condition', () => {
    expect(
      getInvalidOfferLineKey({
        strId: STR_ID,
        offerId: OFFER_ID,
        submittedCondition: 'used',
        offer: { condition: 'used' },
        parentEligible: true,
      })
    ).toBeNull();
  });

  it('passes a live offer when no condition was submitted', () => {
    expect(
      getInvalidOfferLineKey({
        strId: STR_ID,
        offerId: OFFER_ID,
        offer: { condition: 'used' },
        parentEligible: true,
      })
    ).toBeNull();
  });

  it('invalidates a missing live offer row', () => {
    expect(
      getInvalidOfferLineKey({
        strId: STR_ID,
        offerId: OFFER_ID,
        offer: undefined,
        parentEligible: true,
      })
    ).toBe(`${STR_ID}::offer=${OFFER_ID}`);
  });

  it('invalidates a live offer on an ineligible parent', () => {
    expect(
      getInvalidOfferLineKey({
        strId: STR_ID,
        offerId: OFFER_ID,
        offer: { condition: 'used' },
        parentEligible: false,
      })
    ).toBe(`${STR_ID}::offer=${OFFER_ID}`);
  });

  it('invalidates a drifted submitted condition', () => {
    expect(
      getInvalidOfferLineKey({
        strId: STR_ID,
        offerId: OFFER_ID,
        submittedCondition: 'new',
        offer: { condition: 'used' },
        parentEligible: true,
      })
    ).toBe(`${STR_ID}::offer=${OFFER_ID}`);
  });

  it('invalidates a line quantity above the live offer allocation', () => {
    expect(
      getInvalidOfferLineKey({
        strId: STR_ID,
        offerId: OFFER_ID,
        quantity: 3,
        offer: { condition: 'used', stock_quantity: 2 },
        parentEligible: true,
      })
    ).toBe(`${STR_ID}::offer=${OFFER_ID}`);
    expect(
      getInvalidOfferLineKey({
        strId: STR_ID,
        offerId: OFFER_ID,
        quantity: 1,
        offer: { condition: 'used', stock_quantity: 0 },
        parentEligible: true,
      })
    ).toBe(`${STR_ID}::offer=${OFFER_ID}`);
  });

  it('invalidates duplicate lines whose aggregate exceeds the allocation', () => {
    // Two quantity-1 lines for one allocation-1 offer (e.g. canonical
    // aliases kept as separate cart lines): each line alone fits, but
    // the order RPC decrements the shared total and rejects the second.
    const input = {
      strId: STR_ID,
      offerId: OFFER_ID,
      quantity: 1,
      aggregateOfferQuantity: 2,
      offer: { condition: 'used', stock_quantity: 1 },
      parentEligible: true,
    };
    expect(getInvalidOfferLineKey(input)).toBe(`${STR_ID}::offer=${OFFER_ID}`);
    expect(
      getInvalidOfferLineKey({ ...input, aggregateOfferQuantity: 1 })
    ).toBeNull();
  });

  it('passes quantities within the allocation and skips unknown scalars', () => {
    expect(
      getInvalidOfferLineKey({
        strId: STR_ID,
        offerId: OFFER_ID,
        quantity: 2,
        offer: { condition: 'used', stock_quantity: 2 },
        parentEligible: true,
      })
    ).toBeNull();
    expect(
      getInvalidOfferLineKey({
        strId: STR_ID,
        offerId: OFFER_ID,
        quantity: 5,
        offer: { condition: 'used', stock_quantity: null },
        parentEligible: true,
      })
    ).toBeNull();
    expect(
      getInvalidOfferLineKey({
        strId: STR_ID,
        offerId: OFFER_ID,
        offer: { condition: 'used', stock_quantity: 0 },
        parentEligible: true,
      })
    ).toBeNull();
  });

  it('invalidates a contradictory variant+offer combo', () => {
    expect(
      getInvalidOfferLineKey({
        strId: STR_ID,
        variantId: 'v1',
        offerId: OFFER_ID,
        offer: { condition: 'used' },
        parentEligible: true,
      })
    ).toBe(`${STR_ID}::v1::offer=${OFFER_ID}`);
  });

  it('invalidates simple lines whose aggregate exceeds the strict pool', () => {
    const base = {
      strId: STR_ID,
      aggregateSimpleQuantity: 2,
      strictPoolUnits: 1,
      parentEligible: true,
    };
    expect(getInvalidOfferLineKey(base)).toBe(STR_ID);
    expect(
      getInvalidOfferLineKey({
        ...base,
        offerId: OFFER_ID,
        offer: { condition: 'used', stock_quantity: 5 },
      })
    ).toBe(`${STR_ID}::offer=${OFFER_ID}`);
  });

  it('passes simple lines within the strict pool and skips exempt lines', () => {
    const fitting = {
      strId: STR_ID,
      aggregateSimpleQuantity: 1,
      strictPoolUnits: 1,
      parentEligible: true,
    };
    expect(getInvalidOfferLineKey(fitting)).toBeNull();
    // Unknown pool (non-strict product or failed projection read).
    expect(
      getInvalidOfferLineKey({ ...fitting, strictPoolUnits: null })
    ).toBeNull();
    // Voucher lines redeem pre-reserved units outside the pool.
    expect(
      getInvalidOfferLineKey({
        ...fitting,
        aggregateSimpleQuantity: 2,
        strictPoolUnits: 1,
        isQuizVoucherLine: true,
      })
    ).toBeNull();
    // Variant lines never share the simple pool.
    expect(
      getInvalidOfferLineKey({
        ...fitting,
        variantId: 'v1',
        aggregateSimpleQuantity: 2,
        strictPoolUnits: 1,
      })
    ).toBeNull();
  });
});

describe('buildSimpleProductQuantityTotals', () => {
  it('totals base and offer lines while skipping variants and vouchers', () => {
    const totals = buildSimpleProductQuantityTotals([
      { id: STR_ID, quantity: 1 },
      { id: STR_ID, offerId: OFFER_ID, quantity: 2 },
      { id: STR_ID, variantId: 'v1', quantity: 9 },
      { id: STR_ID, quantity: 9, isQuizVoucherLine: true },
      { id: STR_ID },
      { id: 'other', quantity: 4 },
    ]);
    expect(readSimpleProductQuantityTotal(totals, STR_ID)).toBe(3);
    expect(readSimpleProductQuantityTotal(totals, 'other')).toBe(4);
    expect(readSimpleProductQuantityTotal(totals, 'missing')).toBeUndefined();
  });
});

describe('resolveReportedLineStock', () => {
  const item = { offerId: OFFER_ID };

  it('reports the live offer allocation for non-variant offer lines', () => {
    expect(
      resolveReportedLineStock(item, { stock_quantity: 3 }, { stock: 0 })
    ).toBe(3);
  });

  it('falls back to the parent for variant lines', () => {
    expect(
      resolveReportedLineStock(
        { variantId: 'v1', offerId: OFFER_ID },
        { stock_quantity: 3 },
        { stock: 7 }
      )
    ).toBe(7);
  });

  it('falls back to the parent without an offer or finite scalar', () => {
    expect(resolveReportedLineStock({}, undefined, { stock: 7 })).toBe(7);
    expect(
      resolveReportedLineStock(item, { stock_quantity: null }, { stock: 7 })
    ).toBe(7);
    expect(
      resolveReportedLineStock(item, { stock_quantity: 'n/a' }, { stock: 7 })
    ).toBe(7);
  });
});
