import { describe, expect, it } from 'vitest';
import { mentionsMonnifyVendEvidence } from './monnify-vend-evidence-text';

describe('mentionsMonnifyVendEvidence', () => {
  it.each([
    'Insufficient wallet balance; vendReference=MFBP-1',
    'vend_status=FAILED&amount=100',
    'Transaction Reference: MFBP-2',
    'payment-reference = MNFY-PAY-1',
    '{"vendReference":"BACI-REF-123"}',
  ])('sees vend evidence in %s', (text) => {
    expect(mentionsMonnifyVendEvidence(text)).toBe(true);
  });

  it.each([
    'Insufficient wallet balance',
    'vendReference=',
    '{"vendReference":""}',
    'reference=BACI-REF-123',
    '',
    null,
  ])('sees no vend evidence in %s', (text) => {
    expect(mentionsMonnifyVendEvidence(text)).toBe(false);
  });
});
