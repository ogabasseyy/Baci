import { describe, expect, it } from 'vitest';
import { parsePetrockReplay } from '@/lib/imei-providers/petrock/petrock-parser';
import { evaluatePetrockRemediationEligibility } from './petrock-remediation-eligibility';

const baseResult = {
  blacklistStatus: 'Clean',
  carrier: 'US AT&T',
  device: 'iPhone 17 Pro Max',
  financeStatus: 'Clean',
  simLock: 'Locked',
};

const product = {
  carrier: 'AT&T',
  id: 'product-1',
  manualDisabled: false,
  modelScope: { kind: 'range' as const, max: 17, min: 17 },
  statusSegment: 'clean',
};

describe('evaluatePetrockRemediationEligibility', () => {
  it('suppresses a known blacklist risk before asking for missing carrier checks', () => {
    expect(
      evaluatePetrockRemediationEligibility({
        products: [product],
        result: {
          blacklistStatus: 'Blacklisted',
          carrier: 'Unknown',
          simLock: 'Unknown',
        },
      })
    ).toMatchObject({ kind: 'suppressed', reason: 'blacklist_risk' });
  });

  it('offers only a clean, carrier-locked, model-matched product', () => {
    expect(
      evaluatePetrockRemediationEligibility({
        products: [product],
        result: baseResult,
      })
    ).toEqual({ kind: 'eligible', productIds: ['product-1'] });
  });

  it.each([
    'Blacklisted',
    'Lost or Stolen',
    'Blocked',
    'Clean / Reported Lost',
  ])('suppresses a risky blacklist value: %s', (blacklistStatus) => {
    expect(
      evaluatePetrockRemediationEligibility({
        products: [product],
        result: { ...baseResult, blacklistStatus },
      })
    ).toMatchObject({ kind: 'suppressed', reason: 'blacklist_risk' });
  });

  it('suppresses an ambiguous finance status containing a blacklist risk', () => {
    expect(
      evaluatePetrockRemediationEligibility({
        products: [product],
        result: { ...baseResult, financeStatus: 'Clean / Blacklisted' },
      })
    ).toMatchObject({ kind: 'suppressed', reason: 'carrier_status_risk' });
  });

  it('suppresses unknown blacklist evidence instead of buying a house check', () => {
    expect(
      evaluatePetrockRemediationEligibility({
        products: [product],
        result: {
          blacklistStatus: 'Unknown',
          carrier: 'Unknown',
          device: 'iPhone 17 Pro Max',
          simLock: 'Locked',
        },
      })
    ).toEqual({
      kind: 'suppressed',
      reason: 'blacklist_unknown',
    });
  });

  it('suppresses unknown SIM-lock evidence instead of buying a house check', () => {
    expect(
      evaluatePetrockRemediationEligibility({
        products: [product],
        result: { ...baseResult, simLock: 'Unknown' },
      })
    ).toEqual({
      kind: 'suppressed',
      reason: 'not_carrier_locked',
    });
  });

  it('suppresses unlocked, unknown-carrier, unmatched, and disabled offers', () => {
    expect(
      evaluatePetrockRemediationEligibility({
        products: [product],
        result: { ...baseResult, simLock: 'Unlocked' },
      })
    ).toMatchObject({ kind: 'suppressed', reason: 'not_carrier_locked' });
    expect(
      evaluatePetrockRemediationEligibility({
        products: [{ ...product, manualDisabled: true }],
        result: baseResult,
      })
    ).toMatchObject({ kind: 'suppressed', reason: 'no_matching_product' });
  });
});

it.each([
  'Not Eligible',
  'Ineligible',
  'Not Paid',
  'Not Clear',
  'Not Clean',
  'Unpaid',
  'Clean / Not Eligible',
])('never treats negative finance evidence as clean: %s', (finance) => {
  const parsed = parsePetrockReplay(
    `Model: iPhone 17 Pro Max<br>Locked Carrier: US AT&T<br>USA Blacklist: Clean<br>SIMLock: Locked<br>Finance: ${finance}`
  );
  expect(
    evaluatePetrockRemediationEligibility({
      products: [product],
      result: parsed,
    })
  ).toMatchObject({ kind: 'suppressed', reason: 'carrier_status_risk' });
});
it.each([
  'Possibly eligible',
  'Not yet confirmed paid',
  'Clean / Unknown',
  'Unclear',
  'Eligibility pending',
])('requires explicit positive finance evidence: %s', (financeStatus) => {
  expect(
    evaluatePetrockRemediationEligibility({
      products: [product],
      result: { ...baseResult, financeStatus },
    }).kind
  ).not.toBe('eligible');
});
it.each([
  'Clean',
  'Eligible',
  'Paid',
  'Clear',
  'Paid off',
  'Paid in full',
  'Clean / Eligible',
])('retains explicit positive finance evidence: %s', (financeStatus) => {
  expect(
    evaluatePetrockRemediationEligibility({
      products: [product],
      result: { ...baseResult, financeStatus },
    }).kind
  ).toBe('eligible');
});
