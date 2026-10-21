import { describe, expect, it } from 'vitest';
import { coerceOfferAuthorityRow } from './coerce-offer-authority-row';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const OFFER_ID = '22222222-2222-4222-8222-222222222222';

describe('coerceOfferAuthorityRow', () => {
  it('coerces PostgREST string numerics', () => {
    expect(
      coerceOfferAuthorityRow({
        product_id: PRODUCT_ID,
        offer_id: OFFER_ID,
        condition: 'used',
        price_basis: '80.5',
        allocatable_stock: '3',
        parent_eligible: true,
        effective_policy: 'legacy',
        available_units: null,
      })
    ).toEqual({
      productId: PRODUCT_ID,
      offerId: OFFER_ID,
      condition: 'used',
      priceBasis: 80.5,
      allocatableStock: 3,
      parentEligible: true,
      effectivePolicy: 'legacy',
      availableUnits: null,
      compareAtPrice: null,
      grade: null,
      conditionNotes: null,
      images: undefined,
    });
  });

  it('drops rows without an identity', () => {
    expect(coerceOfferAuthorityRow(null)).toBeNull();
    expect(coerceOfferAuthorityRow({ offer_id: OFFER_ID })).toBeNull();
    expect(
      coerceOfferAuthorityRow({ product_id: PRODUCT_ID, offer_id: '' })
    ).toBeNull();
  });

  it('fails closed when the eligibility flag is missing', () => {
    const row = coerceOfferAuthorityRow({
      product_id: PRODUCT_ID,
      offer_id: OFFER_ID,
      condition: 'used',
      price_basis: 80,
      allocatable_stock: 3,
    });
    expect(row?.parentEligible).toBe(false);
  });

  it('keeps unshaped-parent rows with the flag off', () => {
    const row = coerceOfferAuthorityRow({
      product_id: PRODUCT_ID,
      offer_id: OFFER_ID,
      condition: 'used',
      price_basis: 80,
      allocatable_stock: 3,
      parent_eligible: false,
    });
    expect(row?.parentEligible).toBe(false);
    expect(row?.priceBasis).toBe(80);
  });

  it('canonicalizes identity ids to lowercase', () => {
    const row = coerceOfferAuthorityRow({
      product_id: PRODUCT_ID.toUpperCase(),
      offer_id: OFFER_ID.toUpperCase(),
      condition: 'used',
      price_basis: 80,
      allocatable_stock: 3,
      parent_eligible: true,
    });
    expect(row?.productId).toBe(PRODUCT_ID);
    expect(row?.offerId).toBe(OFFER_ID);
  });

  it('parses stringly eligibility flags without Boolean() fail-open', () => {
    const truthy = coerceOfferAuthorityRow({
      product_id: PRODUCT_ID,
      offer_id: OFFER_ID,
      parent_eligible: 'true',
    });
    expect(truthy?.parentEligible).toBe(true);
    const falsy = coerceOfferAuthorityRow({
      product_id: PRODUCT_ID,
      offer_id: OFFER_ID,
      parent_eligible: 'false',
    });
    expect(falsy?.parentEligible).toBe(false);
    const missing = coerceOfferAuthorityRow({
      product_id: PRODUCT_ID,
      offer_id: OFFER_ID,
    });
    expect(missing?.parentEligible).toBe(false);
  });

  it('floors the allocatable stock without clamping negatives', () => {
    const fractional = coerceOfferAuthorityRow({
      product_id: PRODUCT_ID,
      offer_id: OFFER_ID,
      allocatable_stock: 2.9,
      parent_eligible: true,
    });
    expect(fractional?.allocatableStock).toBe(2);
    // Negatives propagate so schema-validated surfaces keep
    // rejecting the corrupt row as unavailable (MCP output
    // contract); every quantity comparison treats them as
    // unpurchasable.
    const negative = coerceOfferAuthorityRow({
      product_id: PRODUCT_ID,
      offer_id: OFFER_ID,
      allocatable_stock: -4,
      parent_eligible: true,
    });
    expect(negative?.allocatableStock).toBe(-4);
    const unbounded = coerceOfferAuthorityRow({
      product_id: PRODUCT_ID,
      offer_id: OFFER_ID,
      allocatable_stock: null,
      parent_eligible: true,
    });
    expect(unbounded?.allocatableStock).toBeNull();
  });
});
