import { oxygenRuntimeSnapshotSchema } from '@baci/shared/oxygen';
import {
  canApproveOxygen,
  defaultOxygenEquity,
  oxygenTermsKey,
  validOxygenPlan,
} from './oxygen-plan';

const limits = {
  productAmount: 100000,
  eligibleAmount: 75000,
  minimumAmount: 10000,
  maxTenure: 6,
  minEquity: 25,
  maxEquity: 90,
};
describe('Oxygen confirmed plan boundaries', () => {
  it('retains period offers when parsing a server snapshot', () => {
    const snapshot = oxygenRuntimeSnapshotSchema.parse({
      workflowId: '11111111-1111-4111-8111-111111111111',
      stage: 'plan_required',
      version: 1,
      environment: 'staging',
      executionEnabled: true,
      state: {
        offers: [
          { tenure: 1, loanAmount: 68000 },
          { tenure: 3, loanAmount: 189000 },
        ],
      },
      approvalOtpReady: false,
      activationEnabled: false,
      settlementEnabled: false,
    });
    expect(snapshot.state.offers?.[1]).toEqual({
      tenure: 3,
      loanAmount: 189000,
    });
  });
  it('respects the maximum for the selected repayment period', () => {
    const withOffers = {
      ...limits,
      productAmount: 198000,
      eligibleAmount: 189000,
      minimumAmount: 68000,
      maxTenure: 3,
      offers: [
        { tenure: 1, loanAmount: 68000 },
        { tenure: 2, loanAmount: 131000 },
        { tenure: 3, loanAmount: 189000 },
      ],
    };
    expect(validOxygenPlan(withOffers, 25, 1)).toBe(false);
    expect(validOxygenPlan(withOffers, 25, 2)).toBe(false);
    expect(validOxygenPlan(withOffers, 25, 3)).toBe(true);
    expect(defaultOxygenEquity(withOffers, 3)).toBe(25);
  });
  it('defaults to 25 only when within authoritative eligibility', () => {
    expect(defaultOxygenEquity(limits)).toBe(25);
    expect(defaultOxygenEquity({ ...limits, eligibleAmount: 60000 })).toBe(40);
    expect(defaultOxygenEquity({ ...limits, productAmount: 9000 })).toBeNull();
  });
  it('finds the lowest equity admitted by the rounded financed amount', () => {
    const roundedLimits = {
      ...limits,
      productAmount: 200000.02,
      eligibleAmount: 132320.01,
      minimumAmount: 132320.01,
      offers: [{ tenure: 3, loanAmount: 132320.01 }],
    };
    expect(validOxygenPlan(roundedLimits, 33.84, 3)).toBe(true);
    expect(defaultOxygenEquity(roundedLimits, 3)).toBe(33.84);
  });

  it('enforces tenure, minimum financed amount and two decimal precision', () => {
    expect(validOxygenPlan(limits, 25, 6)).toBe(true);
    expect(validOxygenPlan(limits, 25, 7)).toBe(false);
    expect(validOxygenPlan({ ...limits, minimumAmount: 20000 }, 90, 6)).toBe(
      false
    );
    expect(validOxygenPlan(limits, 25.001, 6)).toBe(false);
  });
  it('binds signature and acceptance to all material confirmed terms', () => {
    const terms = {
      reference: 'ref',
      upfront: 25000,
      monthly: 26000,
      charges: 3000,
      schedule: [{ period: 1, date: '2026-12-04', amount: 26000 }],
    };
    expect(oxygenTermsKey(terms)).not.toBe(
      oxygenTermsKey({ ...terms, charges: 4000 })
    );
    expect(oxygenTermsKey(terms)).not.toBe(
      oxygenTermsKey({ ...terms, reference: 'other' })
    );
  });
  it('requires usable exact server window and transient consent and blocks uncertain replay', () => {
    const sentAt = '2026-11-04T10:00:00Z';
    const input = {
      reference: 'ref',
      termsKey: 'terms',
      capturedTermsKey: 'terms',
      signature: true,
      accepted: true,
      window: {
        bookingReference: 'ref',
        sentAt,
        expiresAt: '2026-11-04T10:05:00Z',
      },
      now: Date.parse(sentAt) + 1,
      pending: null,
    };
    expect(canApproveOxygen(input)).toBe(true);
    expect(canApproveOxygen({ ...input, window: null })).toBe(false);
    expect(
      canApproveOxygen({ ...input, now: Date.parse(sentAt) + 300000 })
    ).toBe(false);
    expect(canApproveOxygen({ ...input, capturedTermsKey: 'old' })).toBe(false);
    expect(
      canApproveOxygen({
        ...input,
        window: { ...input.window, bookingReference: 'other' },
      })
    ).toBe(false);
    expect(canApproveOxygen({ ...input, pending: 'indeterminate' })).toBe(
      false
    );
    expect(
      canApproveOxygen({ ...input, pending: 'queued', signature: false })
    ).toBe(false);
  });
});
