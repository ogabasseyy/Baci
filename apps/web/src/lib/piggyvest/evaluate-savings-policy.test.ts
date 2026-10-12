import { describe, expect, it } from 'vitest';
import { evaluateSavingsPolicy } from './evaluate-savings-policy';
import { scheduleLifecycleFixture } from './schedule-lifecycle.test-support';

describe('savings decision adapter over shared policy primitives', () => {
  it('excludes pending interest and requires customer review at the full price', () => {
    const policy = scheduleLifecycleFixture().trusted.policy;
    const ledger = {
      ...policy.ledger,
      confirmedPrincipalKobo: 9500,
      pendingInterestKobo: 500,
    };
    expect(evaluateSavingsPolicy({ ...policy, ledger })).toMatchObject({
      purchasingPowerKobo: 9500,
      readiness: 'continue_saving',
      purchaseAction: 'blocked',
    });
    expect(
      evaluateSavingsPolicy({
        ...policy,
        ledger: { ...ledger, paidEligibleInterestKobo: 500 },
      })
    ).toMatchObject({
      purchasingPowerKobo: 10000,
      readiness: 'ready_for_review',
      purchaseAction: 'requires_customer_confirmation',
      collectionAction: 'pause',
    });
  });

  it('quotes all principal back and all interest forfeited without dispatching', () => {
    const policy = scheduleLifecycleFixture().trusted.policy;
    expect(
      evaluateSavingsPolicy({
        ...policy,
        requestedAction: 'cancel',
        ledger: {
          ...policy.ledger,
          paidEligibleInterestKobo: 7,
          pendingInterestKobo: 3,
        },
      })
    ).toMatchObject({
      purchaseAction: 'blocked',
      collectionAction: 'pause',
      cancellation: {
        status: 'quote_available',
        principalRefundKobo: 100,
        paidInterestForfeitureKobo: 7,
        pendingInterestCancelledKobo: 3,
      },
    });
  });

  it.each([
    'productId',
    'variantId',
    'condition',
  ] as const)('rejects a current offer with a different %s', (field) => {
    const policy = scheduleLifecycleFixture().trusted.policy;
    expect(() =>
      evaluateSavingsPolicy({
        ...policy,
        currentOffer: {
          ...policy.currentOffer,
          device: { ...policy.device, [field]: 'different' },
        },
      })
    ).toThrow('Savings offer device mismatch');
  });

  it('keeps the lower valid price without spending pending interest', () => {
    const policy = scheduleLifecycleFixture().trusted.policy;
    const guarantee = {
      version: 'synthetic-guarantee',
      device: policy.device,
      priceKobo: 9000,
      expiresAt: '2026-10-01T00:00:00Z',
    };
    expect(
      evaluateSavingsPolicy({
        ...policy,
        guarantee,
        ledger: { ...policy.ledger, confirmedPrincipalKobo: 9500 },
      })
    ).toMatchObject({
      devicePriceKobo: 9000,
      surplusKobo: 500,
      readiness: 'ready_for_review',
    });
    expect(
      evaluateSavingsPolicy({ ...policy, guarantee, now: guarantee.expiresAt })
    ).toMatchObject({ devicePriceKobo: 9000, readiness: 'continue_saving' });
  });

  it('rejects unsafe sums even when both ledger amounts are individually valid', () => {
    const policy = scheduleLifecycleFixture().trusted.policy;
    expect(() =>
      evaluateSavingsPolicy({
        ...policy,
        ledger: {
          ...policy.ledger,
          confirmedPrincipalKobo: Number.MAX_SAFE_INTEGER,
          paidEligibleInterestKobo: 1,
        },
      })
    ).toThrow();
  });

  it('does not activate from paid interest or an expired quote', () => {
    const policy = scheduleLifecycleFixture().trusted.policy;
    const activationQuote = {
      version: 'synthetic-quote',
      device: policy.device,
      priceKobo: 10000,
      expiresAt: '2026-10-01T00:00:00Z',
    };
    const draft = { ...policy, goalState: 'draft', activationQuote };
    expect(
      evaluateSavingsPolicy({
        ...draft,
        ledger: { ...policy.ledger, paidEligibleInterestKobo: 10000 },
      }).activation
    ).toBe('not_available');
    const funded = {
      ...draft,
      ledger: { ...policy.ledger, confirmedPrincipalKobo: 500 },
    };
    expect(evaluateSavingsPolicy(funded).activation).toBe('activate');
    expect(
      evaluateSavingsPolicy({ ...funded, now: activationQuote.expiresAt })
        .activation
    ).toBe('not_available');
  });

  it.each([
    'activate',
    'device_change',
  ] as const)('does not authorize a different operation when %s is requested', (requestedAction) => {
    const policy = scheduleLifecycleFixture().trusted.policy;
    expect(
      evaluateSavingsPolicy({
        ...policy,
        requestedAction,
        ledger: { ...policy.ledger, confirmedPrincipalKobo: 10000 },
      })
    ).toMatchObject({ activation: 'not_available', purchaseAction: 'blocked' });
  });

  it('does not command resumed or paused collection during an ordinary active read', () => {
    const policy = scheduleLifecycleFixture().trusted.policy;
    expect(
      evaluateSavingsPolicy({ ...policy, collectionPaused: false })
        .collectionAction
    ).toBe('none');
  });
});
