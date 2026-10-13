import { describe, expect, it } from 'vitest';
import {
  createRedvaultPaystackMetadata,
  createRedvaultVerifiedPaymentEvidence,
  evaluateRedvaultCapture,
} from './redvault-payment-gate';

type PaystackVerifyFixture = {
  data: {
    amount: number;
    authorization: { bank: string; brand: string; channel: string };
    channel: string;
    currency: string;
    customer: { email: string };
    domain: string;
    id: number;
    paid_at: string;
    reference: string;
    status: string;
  };
  status: boolean;
};

function createVerifiedPaystackFixture(): PaystackVerifyFixture {
  return {
    data: {
      amount: 9500,
      authorization: { bank: 'UBA TEST BANK', brand: 'visa', channel: 'card' },
      channel: 'card',
      currency: 'NGN',
      customer: { email: 'customer@example.test' },
      domain: 'test',
      id: 42,
      paid_at: '2026-09-12T09:13:00.000Z',
      reference: 'RV-1',
      status: 'success',
    },
    status: true,
  };
}

describe('REDVAULT Paystack payment gate', () => {
  it('uses only the documented card channel filters', () => {
    expect(createRedvaultPaystackMetadata('033')).toEqual({
      custom_filters: {
        banks: ['033'],
        card_brands: ['verve', 'visa', 'mastercard'],
      },
      partnership: 'uba_redvault',
    });
  });

  it('fails closed when the provider-validated bank code is absent or malformed', () => {
    expect(() => createRedvaultPaystackMetadata('')).toThrow('not configured');
    expect(() => createRedvaultPaystackMetadata('0333')).toThrow(
      'not configured'
    );
  });

  it('holds a successful matching card capture when issuer proof is absent', () => {
    expect(
      evaluateRedvaultCapture({
        capture: {
          amount: 9500,
          authorization: { brand: 'visa', channel: 'card' },
          currency: 'NGN',
          reference: 'RV-1',
          status: 'success',
        },
        expectedAmountKobo: 9500,
        expectedCurrency: 'NGN',
        expectedReference: 'RV-1',
      })
    ).toBe('held');
  });

  it.each([
    ['amount', { amount: 1 }],
    ['currency', { currency: 'USD' }],
    ['reference', { reference: 'wrong' }],
    ['method switch', { authorization: { brand: 'visa', channel: 'bank' } }],
  ])('holds a stale or invalid %s capture', (_label, override) => {
    expect(
      evaluateRedvaultCapture({
        capture: {
          amount: 9500,
          authorization: { brand: 'visa', channel: 'card' },
          currency: 'NGN',
          reference: 'RV-1',
          status: 'success',
          ...override,
        },
        expectedAmountKobo: 9500,
        expectedCurrency: 'NGN',
        expectedReference: 'RV-1',
      })
    ).toBe('held');
  });

  it('normalizes only matching server-verified Paystack card evidence', () => {
    expect(
      createRedvaultVerifiedPaymentEvidence({
        acceptedFilterPolicyHash: 'a'.repeat(64),
        expectedAmountKobo: 9500,
        expectedCurrency: 'NGN',
        expectedCustomerEmail: 'customer@example.test',
        expectedDomain: 'test',
        expectedIssuerName: 'UBA TEST BANK',
        expectedReference: 'RV-1',
        verifyResponse: {
          ...createVerifiedPaystackFixture(),
          data: {
            ...createVerifiedPaystackFixture().data,
            customer: { email: 'Customer@example.test' },
          },
        },
      })
    ).toMatchObject({
      cardBrand: 'visa',
      providerVerificationId: '42',
      verificationSource: 'paystack_transaction_verify',
    });
  });

  it.each([
    [
      'top-level API status',
      (fixture: PaystackVerifyFixture) => {
        fixture.status = false;
      },
    ],
    [
      'transaction status',
      (fixture: PaystackVerifyFixture) => {
        fixture.data.status = 'pending';
      },
    ],
    [
      'issuer name',
      (fixture: PaystackVerifyFixture) => {
        fixture.data.authorization.bank = 'OTHER BANK';
      },
    ],
    [
      'customer email',
      (fixture: PaystackVerifyFixture) => {
        fixture.data.customer.email = 'other@example.test';
      },
    ],
    [
      'non-card channel',
      (fixture: PaystackVerifyFixture) => {
        fixture.data.channel = 'bank';
      },
    ],
    [
      'verification domain',
      (fixture: PaystackVerifyFixture) => {
        fixture.data.domain = 'live';
      },
    ],
  ])('rejects verified evidence with mismatched %s', (_label, mutate) => {
    const verifyResponse = createVerifiedPaystackFixture();
    mutate(verifyResponse);
    expect(
      createRedvaultVerifiedPaymentEvidence({
        acceptedFilterPolicyHash: 'a'.repeat(64),
        expectedAmountKobo: 9500,
        expectedCurrency: 'NGN',
        expectedCustomerEmail: 'customer@example.test',
        expectedDomain: 'test',
        expectedIssuerName: 'UBA TEST BANK',
        expectedReference: 'RV-1',
        verifyResponse,
      })
    ).toBeNull();
  });
});
