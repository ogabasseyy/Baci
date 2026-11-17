import { describe, expect, it } from 'vitest';
import { mentionsMonnifyVendEvidence } from './monnify-vend-evidence-text';

describe('mentionsMonnifyVendEvidence', () => {
  it.each([
    'Insufficient wallet balance; vendReference=MFBP-1',
    'vend_status=FAILED&amount=100',
    'Transaction Reference: MFBP-2',
    'payment-reference = MNFY-PAY-1',
    '{"vendReference":"BACI-REF-123"}',
    'Insufficient wallet balance vendReference MFBP-1',
    'transaction reference MFBP-2',
    'Insufficient balance; reference=MFBP-3',
    'Insufficient wallet balance; transactionId=MFBP-1',
    'order_id: 12345',
  ])('sees vend evidence in %s', (text) => {
    expect(mentionsMonnifyVendEvidence(text)).toBe(true);
  });

  it.each([
    'Insufficient wallet balance',
    'vendReference=',
    '{"vendReference":""}',
    'Invalid customer reference',
    'transaction reference not found',
    '',
    null,
  ])('sees no vend evidence in %s', (text) => {
    expect(mentionsMonnifyVendEvidence(text)).toBe(false);
  });
});
