import { describe, expect, it } from 'vitest';
import { buildMonnifyUnresolvedVendResult } from './monnify-unresolved-vend-result';

describe('buildMonnifyUnresolvedVendResult', () => {
  it('is a pending, never-refunded, never-Kuda result', () => {
    expect(
      buildMonnifyUnresolvedVendResult({
        amount: 100,
        message: 'Unexpected error',
        requestReference: 'REQ-1',
      })
    ).toEqual({
      success: false,
      reference: 'REQ-1',
      message: 'Unexpected error',
      status: 'pending',
      amount: 100,
      providerDefiniteFailure: false,
      providerOutcomeUnresolved: true,
    });
  });

  it("carries Monnify's vendReference as the transaction id for requery", () => {
    expect(
      buildMonnifyUnresolvedVendResult({
        amount: 100,
        message: 'm',
        providerResponseCode: '99',
        providerErrorDetail: 'd',
        providerVendReference: 'MFBP-1',
        requestReference: 'REQ-1',
      })
    ).toMatchObject({
      providerVendReference: 'MFBP-1',
      transactionId: 'MFBP-1',
      providerResponseCode: '99',
      providerErrorDetail: 'd',
    });
  });
});

describe('bugfix: a held result never has an empty message', () => {
  it.each(['', '   '])('falls back for message "%s"', (message) => {
    const result = buildMonnifyUnresolvedVendResult({
      amount: 100,
      message,
      requestReference: 'REQ-1',
    });
    expect(result.message.trim()).not.toBe('');
  });
});
