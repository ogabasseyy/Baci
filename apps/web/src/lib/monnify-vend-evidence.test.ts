import { describe, expect, it } from 'vitest';
import { hasMonnifyVendEvidence } from './monnify-vend-evidence';

describe('hasMonnifyVendEvidence', () => {
  it.each([
    { responseBody: { vendStatus: 'PENDING' } },
    { responseBody: { transactionReference: 'MFBP-1' } },
    { responseBody: { vendReference: 'BACI-REF-123' } },
    { responseBody: { transactionReference: 12345 } },
    { vendStatus: 'FAILED', responseMessage: 'Insufficient wallet balance' },
    { responseBody: { status: 'FAILED' } },
    { status: 'In_Progress' },
    { responseBody: { status: 'UNKNOWN' } },
    { status: 'PENDING_CONFIRMATION' },
    { transactionId: 'MFBP-9' },
    { responseBody: { orderReference: 'ORD-1' } },
    { referenceNumber: '12345' },
    { responseBody: { paymentReference: 'MNFY-PAY-1' } },
    { vend_reference: 'BACI-REF-123' },
    { TransactionReference: 'MFBP-1' },
    { response_body: { vend_status: 'FAILED' } },
    { ResponseBody: { Status: 'PENDING' } },
    { responseBody: { reference: 'MFBP-1' } },
    { status: 'FAILED', responseMessage: 'Insufficient wallet balance' },
    { responseBody: { data: { vendStatus: 'FAILED' } } },
    { responseBody: { items: [{ transactionReference: 'MFBP-2' }] } },
    { data: { vend: { reference: 'MFBP-3' } } },
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
    { status: 400, error: 'Bad Request' },
    { error: { status: 400, message: 'Bad Request' } },
    { status: '400', responseMessage: 'Insufficient wallet balance' },
    { status: 'error', responseMessage: 'Insufficient wallet balance' },
    { status: 'Bad Request' },
    { requestReference: 'BACI-REF-123' },
    { responseBody: { status: ' 422 ' } },
    { responseBody: { status: 200 } },
    { reference: 'BACI-REF-123', responseMessage: 'Insufficient balance' },
  ])('sees no vend evidence in %j', (envelope) => {
    expect(hasMonnifyVendEvidence(envelope)).toBe(false);
  });
});
