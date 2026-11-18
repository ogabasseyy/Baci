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
    'status=FAILED&responseMessage=Insufficient wallet balance',
    'status: pending',
    'transactionStatus=FAILED&message=Insufficient wallet balance',
    'payment_status=FAILED',
    'receiptNumber=RCPT-1&message=Insufficient wallet balance',
    'invoice_id=INV-9',
    'transactionRef=MFBP-1&message=Insufficient wallet balance',
    'vendRef=MFBP-1',
    'paymentRef: MFBP-1',
  ])('sees vend evidence in %s', (text) => {
    expect(mentionsMonnifyVendEvidence(text)).toBe(true);
  });

  it.each([
    'Insufficient wallet balance',
    'vendReference=',
    '{"vendReference":""}',
    'Invalid customer reference',
    'transaction reference not found',
    'status=error&responseMessage=Insufficient wallet balance',
    'status: Bad Request',
    'status=400',
    'status=Bad_Request&responseMessage=Insufficient wallet balance',
    'status=Internal-Server-Error',
    '',
    null,
  ])('sees no vend evidence in %s', (text) => {
    expect(mentionsMonnifyVendEvidence(text)).toBe(false);
  });
});
