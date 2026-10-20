import { describe, expect, it } from 'vitest';
import {
  buildSimpleProductQuantityTotals,
  getCartValidationKey,
  getInvalidOfferLineKey,
  readSimpleProductQuantityTotal,
  resolveReportedLineStock,
} from './resolve-cart-validation-offer-line';

const STR_ID = '11111111-1111-4111-8111-111111111111';
const OFFER_ID = '55555555-5555-4555-8555-555555555555';

describe('getCartValidationKey', () => {
  it('builds product, variant, and offer keys', () => {
    expect(getCartValidationKey(STR_ID)).toBe(STR_ID);
    expect(getCartValidationKey(STR_ID, 'v1')).toBe(`${STR_ID}::v1`);
    expect(getCartValidationKey(STR_ID, undefined, OFFER_ID)).toBe(
      `${STR_ID}::offer=${OFFER_ID}`
    );
  });
});

describe('getInvalidOfferLineKey', () => {
  it('passes non-offer lines', () => {
    expect(
      getInvalidOfferLineKey({
        strId: STR_ID,
        offer: undefined,
      })
    ).toBeNull();
  });

  it('passes a live offer on an eligible parent with matching condition', () => {
    expect(
      getInvalidOfferLineKey({
        strId: STR_ID,
        offerId: OFFER_ID,
        submittedCondition: 'used',
        offer: { condition: 'used', parent_eligible: true },
      })
    ).toBeNull();
  });

  it('passes a live offer when no condition was submitted', () => {
    expect(
      getInvalidOfferLineKey({
        strId: STR_ID,
        offerId: OFFER_ID,
        offer: { condition: 'used', parent_eligible: true },
      })
    ).toBeNull();
  });

  it('invalidates a missing live offer row', () => {
    expect(
      getInvalidOfferLineKey({
        strId: STR_ID,
        offerId: OFFER_ID,
        offer: undefined,
      })
    ).toBe(`${STR_ID}::offer=${OFFER_ID}`);
  });

  it('invalidates a live offer on an ineligible parent', () => {
    expect(
      getInvalidOfferLineKey({
        strId: STR_ID,
        offerId: OFFER_ID,
        offer: { condition: 'used', parent_eligible: false },
      })
    ).toBe(`${STR_ID}::offer=${OFFER_ID}`);
  });

  it('fails closed when the authority flag is missing', () => {
    expect(
      getInvalidOfferLineKey({
        strId: STR_ID,
        offerId: OFFER_ID,
        offer: { condition: 'used' },
      })
    ).toBe(`${STR_ID}::offer=${OFFER_ID}`);
  });

  it('invalidates a drifted submitted condition', () => {
    expect(
      getInvalidOfferLineKey({
        strId: STR_ID,
        offerId: OFFER_ID,
        submittedCondition: 'new',
        offer: { condition: 'used', parent_eligible: true },
      })
    ).toBe(`${STR_ID}::offer=${OFFER_ID}`);
  });

  it('invalidates a line quantity above the live offer allocation', () => {
    expect(
      getInvalidOfferLineKey({
        strId: STR_ID,
        offerId: OFFER_ID,
        quantity: 3,
        offer: { condition: 'used', stock_quantity: 2, parent_eligible: true },
      })
    ).toBe(`${STR_ID}::offer=${OFFER_ID}`);
    expect(
      getInvalidOfferLineKey({
        strId: STR_ID,
        offerId: OFFER_ID,
        quantity: 1,
        offer: { condition: 'used', stock_quantity: 0, parent_eligible: true },
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
      offer: { condition: 'used', stock_quantity: 1, parent_eligible: true },
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
        offer: { condition: 'used', stock_quantity: 2, parent_eligible: true },
      })
    ).toBeNull();
    expect(
      getInvalidOfferLineKey({
        strId: STR_ID,
        offerId: OFFER_ID,
        quantity: 5,
        offer: {
          condition: 'used',
          stock_quantity: null,
          parent_eligible: true,
        },
      })
    ).toBeNull();
    expect(
      getInvalidOfferLineKey({
        strId: STR_ID,
        offerId: OFFER_ID,
        offer: { condition: 'used', stock_quantity: 0, parent_eligible: true },
      })
    ).toBeNull();
  });

  it('invalidates a contradictory variant+offer combo', () => {
    expect(
      getInvalidOfferLineKey({
        strId: STR_ID,
        variantId: 'v1',
        offerId: OFFER_ID,
        offer: { condition: 'used', parent_eligible: true },
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
    expect(getInvalidOfferLineKey(base)).toBe(`${STR_ID}::base`);
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
