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
    { responseBody: { status: 'CANCELLED' } },
    { status: 'DECLINED' },
    { transactionStatus: 'FAILED', message: 'Insufficient wallet balance' },
    { responseBody: { receiptNumber: 'RCPT-1' } },
    { invoice_id: 'INV-9' },
    { responseBody: { paymentId: 'PAY-1' } },
    { purchase_id: 'PUR-1' },
    { responseBody: { transactionNumber: 'MFBP-1' } },
    { transaction_no: 'MFBP-2' },
    { responseBody: { payment_status: 'PENDING' } },
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
    { responseBody: { validationReference: 'VAL-1' } },
    { responseBody: { data: { requestReference: 'BACI-REF-123' } } },
    { status: 'Internal Server Error' },
    { responseBody: { status: ' 422 ' } },
    { responseBody: { status: 200 } },
    {
      reference: '0123456789abcdef01234567',
      responseMessage: 'Insufficient balance',
    },
    { status: 'Payment Required', message: 'Insufficient wallet balance' },
    { status: '400 Bad Request', message: 'Insufficient wallet balance' },
  ])('sees no vend evidence in %j', (envelope) => {
    expect(hasMonnifyVendEvidence(envelope)).toBe(false);
  });
});

describe('bugfix: top-level arrays are read item by item', () => {
  it('sees vend evidence in a top-level array of error objects', () => {
    expect(
      hasMonnifyVendEvidence([
        { transactionStatus: 'FAILED', message: 'Insufficient wallet balance' },
      ])
    ).toBe(true);
  });

  it('sees none in an array without vend fields', () => {
    expect(
      hasMonnifyVendEvidence([{ message: 'Insufficient wallet balance' }])
    ).toBe(false);
  });
});

describe('bugfix: true outcome flags are vend evidence', () => {
  it.each([
    { responseBody: { processed: true } },
    { isDelivered: 'true' },
    { responseBody: { in_progress: 1 } },
    { responseBody: { isFailed: true } },
    { responseBody: { fulfilled: true } },
    { is_reversed: 'yes' },
  ])('sees vend evidence in %j', (answer) => {
    expect(hasMonnifyVendEvidence(answer)).toBe(true);
  });

  it.each([
    { responseBody: { processed: false } },
    { isDelivered: 'false' },
  ])('sees none in %j', (answer) => {
    expect(hasMonnifyVendEvidence(answer)).toBe(false);
  });
});

describe('bugfix: a provider-issued top-level reference is evidence', () => {
  it.each([
    { reference: 'MFBP-1', message: 'Insufficient wallet balance' },
    { reference: 12345 },
  ])('sees vend evidence in %j', (answer) => {
    expect(hasMonnifyVendEvidence(answer)).toBe(true);
  });
});

describe('bugfix: deep nesting and array-valued vend fields fail closed', () => {
  it('sees vend evidence in an array-valued status', () => {
    expect(
      hasMonnifyVendEvidence({
        transactionStatus: ['FAILED'],
        message: 'Insufficient wallet balance',
      })
    ).toBe(true);
  });

  it('treats nesting deeper than the scan limit as evidence', () => {
    expect(
      hasMonnifyVendEvidence({
        a: {
          b: { c: { d: { e: { f: { g: { transactionStatus: 'FAILED' } } } } } },
        },
      })
    ).toBe(true);
  });
});

describe('bugfix: spaced and final-status keys are vend fields', () => {
  it.each([
    { 'transaction status': 'FAILED', message: 'Insufficient wallet balance' },
    { finalStatus: 'FAILED', message: 'Insufficient wallet balance' },
    { responseBody: { 'Vend Reference': 'MFBP-1' } },
  ])('sees vend evidence in %j', (answer) => {
    expect(hasMonnifyVendEvidence(answer)).toBe(true);
  });

  it.each([
    { finalStatus: 'Bad Request' },
    { responseStatus: 400 },
  ])('sees none in %j', (answer) => {
    expect(hasMonnifyVendEvidence(answer)).toBe(false);
  });
});
