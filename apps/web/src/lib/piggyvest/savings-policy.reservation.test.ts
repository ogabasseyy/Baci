import { describe, expect, it } from 'vitest';
import { evaluateSavingsPolicy } from './savings-policy';

describe('bugfix: existing reservations during ordinary savings reads', () => {
  it.each([
    'purchase',
    'cancellation',
  ] as const)('blocks purchase confirmation while a %s reservation exists', (reservation) => {
    const device = {
      productId: 'device',
      variantId: 'variant',
      condition: 'new',
    };
    const decision = evaluateSavingsPolicy({
      policyVersion: '2026-09-11',
      now: '2026-09-12T12:00:00.000Z',
      goalState: 'active',
      requestedAction: 'none',
      collectionPaused: false,
      hasBeforeFundingConsent: true,
      cancellationInterestForfeitureConsentVersion: '2026-09-11',
      device,
      activationQuote: {
        version: 'activation-v1',
        device,
        priceKobo: 10000,
        expiresAt: '2026-09-19T12:00:00.000Z',
      },
      ledger: {
        confirmedPrincipalKobo: 20000,
        reservedPrincipalKobo: 10000,
        paidEligibleInterestKobo: 0,
        reservedPaidInterestKobo: 0,
        pendingInterestKobo: 0,
      },
      currentOffer: { device, priceKobo: 10000 },
      guarantee: {
        version: 'guarantee-v1',
        device,
        priceKobo: 10000,
        expiresAt: '2026-09-19T12:00:00.000Z',
      },
      reservation,
    });

    expect(decision.purchasingPowerKobo).toBe(10000);
    expect(decision.purchaseAction).toBe('blocked');
    expect(decision.transition).toBe('blocked_by_existing_reservation');
  });
});
