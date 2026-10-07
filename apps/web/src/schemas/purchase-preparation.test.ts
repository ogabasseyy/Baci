import { describe, expect, it } from 'vitest';
import { purchasePreparationSchemas } from './purchase-preparation';

const uuid = '00000000-0000-4000-8000-000000000000';
const termsHash = 'a'.repeat(64);

const quote = {
  quoteId: uuid,
  revisionId: uuid,
  productId: uuid,
  variantId: null,
  condition: 'new',
  currency: 'NGN',
  quantity: 1,
  termsVersion: 'v1',
  termsHash,
  deviceKobo: 800,
  deliveryKobo: 100,
  taxKobo: 50,
  feeKobo: 50,
  totalKobo: 1000,
  savingsKobo: 800,
  otherPaymentKobo: 200,
  principalKobo: 800,
  paidInterestKobo: 0,
  surplusKobo: 0,
  expiresAt: '2026-10-07T00:00:00Z',
};

describe('purchasePreparationSchemas', () => {
  it('accepts a balanced quote', () => {
    expect(purchasePreparationSchemas.quote.safeParse(quote).success).toBe(
      true
    );
  });

  it('rejects an unbalanced quote total', () => {
    expect(
      purchasePreparationSchemas.quote.safeParse({ ...quote, totalKobo: 999 })
        .success
    ).toBe(false);
  });

  it('accepts a selection and operation by id', () => {
    expect(
      purchasePreparationSchemas.selection.safeParse({ quoteId: uuid }).success
    ).toBe(true);
    expect(
      purchasePreparationSchemas.operation.safeParse({ operationId: uuid })
        .success
    ).toBe(true);
  });

  it('requires exactly one quote row', () => {
    expect(purchasePreparationSchemas.rows.safeParse([]).success).toBe(false);
  });
});
