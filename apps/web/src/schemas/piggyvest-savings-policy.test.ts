import { describe, expect, it } from 'vitest';
import { piggyvestSavingsPolicyInputSchema } from './piggyvest-savings-policy';

const validInput = {
  policyVersion: '2026-09-11',
  now: '2026-09-12T12:00:00.000Z',
  goalState: 'draft',
  requestedAction: 'none',
  collectionPaused: false,
  hasBeforeFundingConsent: true,
  cancellationInterestForfeitureConsentVersion: '2026-09-11',
  device: {
    productId: 'iphone-16',
    variantId: '128gb-black',
    condition: 'new',
  },
  ledger: {
    confirmedPrincipalKobo: 500_000,
    reservedPrincipalKobo: 0,
    paidEligibleInterestKobo: 0,
    reservedPaidInterestKobo: 0,
    pendingInterestKobo: 0,
  },
  activationQuote: {
    version: 'activation-v1',
    device: {
      productId: 'iphone-16',
      variantId: '128gb-black',
      condition: 'new',
    },
    priceKobo: 10_000_000,
    expiresAt: '2026-09-13T12:00:00.000Z',
  },
  currentOffer: {
    device: {
      productId: 'iphone-16',
      variantId: '128gb-black',
      condition: 'new',
    },
    priceKobo: 10_000_000,
  },
  guarantee: {
    version: 'guarantee-v1',
    device: {
      productId: 'iphone-16',
      variantId: '128gb-black',
      condition: 'new',
    },
    priceKobo: 10_000_000,
    expiresAt: '2026-09-19T12:00:00.000Z',
  },
  reservation: 'none',
};

describe('piggyvestSavingsPolicyInputSchema', () => {
  it('accepts synthetic integer kobo policy inputs', () => {
    expect(
      piggyvestSavingsPolicyInputSchema.safeParse(validInput).success
    ).toBe(true);
  });

  it('rejects fractional, negative, and unsafe kobo amounts', () => {
    for (const amount of [1.5, -1, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        piggyvestSavingsPolicyInputSchema.safeParse({
          ...validInput,
          currentOffer: { ...validInput.currentOffer, priceKobo: amount },
        }).success
      ).toBe(false);
    }
  });

  it('rejects a reserved amount greater than its confirmed balance', () => {
    expect(
      piggyvestSavingsPolicyInputSchema.safeParse({
        ...validInput,
        ledger: { ...validInput.ledger, reservedPrincipalKobo: 500_001 },
      }).success
    ).toBe(false);
  });

  it('rejects reserved funds without an operation reservation or pending state', () => {
    const reservedLedger = {
      ...validInput.ledger,
      confirmedPrincipalKobo: 1_000_000,
      reservedPrincipalKobo: 250_000,
      paidEligibleInterestKobo: 50_000,
      reservedPaidInterestKobo: 50_000,
    };

    expect(
      piggyvestSavingsPolicyInputSchema.safeParse({
        ...validInput,
        goalState: 'active',
        reservation: 'none',
        ledger: reservedLedger,
      }).success
    ).toBe(false);
    expect(
      piggyvestSavingsPolicyInputSchema.safeParse({
        ...validInput,
        goalState: 'purchase_pending',
        reservation: 'none',
        ledger: reservedLedger,
      }).success
    ).toBe(true);
  });

  it('rejects omitted or unrecognised cancellation-forfeiture consent versions', () => {
    const {
      cancellationInterestForfeitureConsentVersion: _ignored,
      ...withoutConsent
    } = validInput;

    expect(
      piggyvestSavingsPolicyInputSchema.safeParse(withoutConsent).success
    ).toBe(false);
    expect(
      piggyvestSavingsPolicyInputSchema.safeParse({
        ...validInput,
        cancellationInterestForfeitureConsentVersion: '2025-01-01',
      }).success
    ).toBe(false);
  });
});
