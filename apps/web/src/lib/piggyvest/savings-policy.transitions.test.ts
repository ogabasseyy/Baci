import { describe, expect, it } from 'vitest';
import { evaluateSavingsPolicy } from './savings-policy';

const device = {
  productId: 'iphone-16',
  variantId: '128gb-black',
  condition: 'new',
};

function policyInput(overrides = {}) {
  return {
    policyVersion: '2026-09-11',
    now: '2026-09-12T12:00:00.000Z',
    goalState: 'draft',
    requestedAction: 'none',
    collectionPaused: false,
    hasBeforeFundingConsent: true,
    cancellationInterestForfeitureConsentVersion: '2026-09-11',
    device,
    ledger: {
      confirmedPrincipalKobo: 500_000,
      reservedPrincipalKobo: 0,
      paidEligibleInterestKobo: 0,
      reservedPaidInterestKobo: 0,
      pendingInterestKobo: 0,
    },
    activationQuote: {
      version: 'activation-v1',
      device,
      priceKobo: 10_000_000,
      expiresAt: '2026-09-13T12:00:00.000Z',
    },
    currentOffer: { device, priceKobo: 10_000_000 },
    guarantee: {
      version: 'guarantee-v1',
      device,
      priceKobo: 10_000_000,
      expiresAt: '2026-09-19T12:00:00.000Z',
    },
    reservation: 'none',
    ...overrides,
  };
}

describe('evaluateSavingsPolicy transitions', () => {
  it.each([
    'cancelled',
    'purchased',
  ] as const)('does not activate, become ready, or allow purchase for a %s goal', (goalState) => {
    const decision = evaluateSavingsPolicy(
      policyInput({
        goalState,
        requestedAction: 'checkout',
        ledger: {
          confirmedPrincipalKobo: 10_000_000,
          reservedPrincipalKobo: 0,
          paidEligibleInterestKobo: 0,
          reservedPaidInterestKobo: 0,
          pendingInterestKobo: 0,
        },
      })
    );

    expect(decision.activation).toBe('not_available');
    expect(decision.readiness).toBe('not_available');
    expect(decision.purchaseAction).toBe('blocked');
    expect(decision.transition).toBe('not_allowed_for_goal_state');
  });

  it.each([
    'active',
    'purchase_pending',
  ] as const)('does not activate an already %s goal', (goalState) => {
    const decision = evaluateSavingsPolicy(
      policyInput({
        goalState,
        requestedAction: 'activate',
      })
    );

    expect(decision.activation).toBe('not_available');
  });

  it('blocks every requested operation while any reservation exists, including the same kind', () => {
    const decision = evaluateSavingsPolicy(
      policyInput({ reservation: 'purchase', requestedAction: 'checkout' })
    );

    expect(decision.transition).toBe('blocked_by_existing_reservation');
  });

  it('blocks activation while a purchase or cancellation reservation exists', () => {
    for (const reservation of ['purchase', 'cancellation'] as const) {
      const decision = evaluateSavingsPolicy(
        policyInput({ reservation, requestedAction: 'activate' })
      );

      expect(decision.activation).toBe('not_available');
      expect(decision.transition).toBe('blocked_by_existing_reservation');
    }
  });

  it('does not make a funded draft ready for purchase before durable activation', () => {
    const decision = evaluateSavingsPolicy(
      policyInput({
        ledger: {
          confirmedPrincipalKobo: 10_000_000,
          reservedPrincipalKobo: 0,
          paidEligibleInterestKobo: 0,
          reservedPaidInterestKobo: 0,
          pendingInterestKobo: 0,
        },
      })
    );

    expect(decision.activation).toBe('activate');
    expect(decision.readiness).toBe('not_available');
    expect(decision.purchaseAction).toBe('blocked');
  });

  it('requires recorded before-funding consent before active funding can become ready', () => {
    const decision = evaluateSavingsPolicy(
      policyInput({
        goalState: 'active',
        hasBeforeFundingConsent: false,
        ledger: {
          confirmedPrincipalKobo: 10_000_000,
          reservedPrincipalKobo: 0,
          paidEligibleInterestKobo: 0,
          reservedPaidInterestKobo: 0,
          pendingInterestKobo: 0,
        },
      })
    );

    expect(decision.readiness).toBe('not_available');
    expect(decision.purchaseAction).toBe('blocked');
  });

  it.each([
    { fundingReversed: true },
    { maturityGraceExpiresAt: '2026-09-12T12:00:00.000Z' },
  ])('blocks activation when the plan requires review: %o', (reviewState) => {
    const decision = evaluateSavingsPolicy(
      policyInput({ ...reviewState, requestedAction: 'activate' })
    );

    expect(decision.activation).toBe('not_available');
    expect(decision.readiness).toBe('review_required');
  });

  it('does not offer a cancellation quote from a cancellation-pending goal', () => {
    const decision = evaluateSavingsPolicy(
      policyInput({
        goalState: 'cancellation_pending',
        requestedAction: 'cancel',
      })
    );

    expect(decision.transition).toBe('blocked_by_existing_reservation');
    expect(decision.cancellation).toEqual({ status: 'not_requested' });
  });

  it('rejects cancellation instead of silently quoting a partial refund from inconsistent reserves', () => {
    expect(() =>
      evaluateSavingsPolicy(
        policyInput({
          goalState: 'active',
          requestedAction: 'cancel',
          ledger: {
            confirmedPrincipalKobo: 1_000_000,
            reservedPrincipalKobo: 250_000,
            paidEligibleInterestKobo: 0,
            reservedPaidInterestKobo: 0,
            pendingInterestKobo: 0,
          },
        })
      )
    ).toThrow('Reserved funds require an operation reservation');
  });

  it('accepts a simple product with a null variant identity', () => {
    const simpleDevice = { ...device, variantId: null };
    const decision = evaluateSavingsPolicy(
      policyInput({
        device: simpleDevice,
        activationQuote: {
          version: 'activation-v1',
          device: simpleDevice,
          priceKobo: 10_000_000,
          expiresAt: '2026-09-13T12:00:00.000Z',
        },
        currentOffer: { device: simpleDevice, priceKobo: 10_000_000 },
        guarantee: {
          version: 'guarantee-v1',
          device: simpleDevice,
          priceKobo: 10_000_000,
          expiresAt: '2026-09-19T12:00:00.000Z',
        },
      })
    );

    expect(decision.devicePriceKobo).toBe(10_000_000);
  });
});
