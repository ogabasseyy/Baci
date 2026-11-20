import { describe, expect, it } from 'vitest';
import { hasMonnifyProviderReference } from './monnify-rejection-vend-reference';
import { hasMonnifyExplicitVendFailure } from './monnify-unresolved-answer';

const REQ = 'a1b2c3d4e5f6a1b2c3d4e5f6';

describe('bugfix: flattened error and ancillary keys are not vend evidence', () => {
  it.each([
    'errorStatus',
    'exceptionStatus',
    'authStatus',
    'credentialStatus',
    'loginStatus',
  ])('ignores %s: FAILED as proof the vend failed', (key) => {
    expect(
      hasMonnifyExplicitVendFailure({ responseBody: { [key]: 'FAILED' } })
    ).toBe(false);
  });

  it.each([
    'refundReference',
    'reversalReference',
    'chargebackReference',
    'settlementReference',
  ])('ignores %s as a vend reference', (key) => {
    expect(
      hasMonnifyProviderReference({ responseBody: { [key]: 'X-1' } }, REQ)
    ).toBe(false);
  });

  it('still accepts a real vendStatus and transactionReference', () => {
    expect(
      hasMonnifyExplicitVendFailure({ responseBody: { vendStatus: 'FAILED' } })
    ).toBe(true);
    expect(
      hasMonnifyProviderReference(
        { responseBody: { transactionReference: 'T-1' } },
        REQ
      )
    ).toBe(true);
  });
});
