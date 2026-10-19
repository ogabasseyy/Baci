import { describe, expect, it } from 'vitest';
import { repairPickupPaymentClaims } from './repair-pickup-payment-claim';

const secret = 'paystack-secret-for-tests';
const input = {
  amountKobo: 825_000,
  currency: 'NGN',
  merchantId: '123e4567-e89b-12d3-a456-426614174000',
  reference: 'REP-ABC123',
  repairId: '223e4567-e89b-12d3-a456-426614174000',
};

describe('repair pickup payment claims', () => {
  it('verifies the exact server-issued payment claim', () => {
    const claim = repairPickupPaymentClaims.create(input, secret);

    expect(repairPickupPaymentClaims.verify(claim, secret)).toEqual(input);
  });

  it('rejects a paid amount that differs from the signed pickup quote', () => {
    const claim = repairPickupPaymentClaims.create(input, secret);

    expect(
      repairPickupPaymentClaims.verify(
        { ...claim, pickup_amount_kobo: input.amountKobo - 100 },
        secret
      )
    ).toBeNull();
  });

  it('rejects an invalid signature without throwing', () => {
    const claim = repairPickupPaymentClaims.create(input, secret);

    expect(
      repairPickupPaymentClaims.verify(
        { ...claim, pickup_claim_signature: 'not-a-valid-signature' },
        secret
      )
    ).toBeNull();
  });
});
