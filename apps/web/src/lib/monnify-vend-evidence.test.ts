import { describe, expect, it } from 'vitest';
import { hasMonnifyVendEvidence } from './monnify-vend-evidence';

describe('hasMonnifyVendEvidence', () => {
  it.each([
    { responseBody: { vendStatus: 'PENDING' } },
    { responseBody: { transactionReference: 'MFBP-1' } },
    { responseBody: { vendReference: 'BACI-REF-123' } },
    { responseBody: { transactionReference: 12345 } },
  ])('sees vend evidence in %j', (envelope) => {
    expect(hasMonnifyVendEvidence(envelope)).toBe(true);
  });

  it.each([
    null,
    'text',
    {},
    { responseBody: null },
    { responseBody: { reason: 'Low balance' } },
    { responseBody: { vendStatus: '  ', vendReference: null } },
  ])('sees no vend evidence in %j', (envelope) => {
    expect(hasMonnifyVendEvidence(envelope)).toBe(false);
  });
});
