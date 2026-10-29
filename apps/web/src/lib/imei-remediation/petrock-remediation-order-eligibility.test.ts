import { describe, expect, it } from 'vitest';
import { isPetrockRemediationOrderEligible } from './petrock-remediation-order-eligibility';

const evidence = {
  blacklistStatus: 'Clean',
  simLock: 'Locked',
  carrier: 'US AT&T',
  device: 'iPhone 17 Pro Max',
  financeStatus: 'Clean',
};
const product = {
  curatedProductId: 'p1',
  carrier: 'AT&T',
  statusSegment: 'clean',
  modelScope: { kind: 'range', min: 17, max: 17 },
};
describe('saved remediation evidence', () => {
  it('accepts a matching explicitly eligible device', () =>
    expect(isPetrockRemediationOrderEligible(evidence, product)).toBe(true));
  it.each([
    null,
    [],
    {},
    { ...evidence, financeStatus: 123 },
    { ...evidence, blacklistStatus: 'Unknown' },
    { ...evidence, simLock: 'Unlocked' },
    { ...evidence, financeStatus: 'Not Paid' },
    { ...evidence, financeStatus: 'Unknown' },
  ])('fails closed for unsafe or malformed evidence: %j', (value) =>
    expect(isPetrockRemediationOrderEligible(value, product)).toBe(false));
  it.each([
    { ...product, carrier: 'Verizon' },
    { ...product, modelScope: { kind: 'range', min: 12, max: 14 } },
    { ...product, modelScope: null },
    { ...product, statusSegment: 'past_due' },
  ])('revalidates the selected product scope: %j', (value) =>
    expect(isPetrockRemediationOrderEligible(evidence, value)).toBe(false));
});
