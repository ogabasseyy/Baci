import { describe, expect, it } from 'vitest';
import { extractDuplicateCaptureEvidence } from './extract-duplicate-capture-evidence';

describe('extractDuplicateCaptureEvidence', () => {
  it('takes the Paystack minor-unit total and numeric charge id verbatim', () => {
    expect(
      extractDuplicateCaptureEvidence('paystack', {
        amount: 5829060,
        currency: 'NGN',
        id: 123456789,
        reference: 'BAC-REF',
        status: 'success',
      })
    ).toEqual({
      providerAmount: 5829060,
      providerReference: '123456789',
      providerStatus: 'success',
    });
  });

  it('takes the Korapay major-unit total with the reference as charge id', () => {
    expect(
      extractDuplicateCaptureEvidence('korapay', {
        amount: 58290.6,
        currency: 'NGN',
        reference: 'BAC-KORA',
        status: 'success',
      })
    ).toEqual({
      providerAmount: 58290.6,
      providerReference: 'BAC-KORA',
      providerStatus: 'success',
    });
  });

  it('takes the Juicyway settled total, payment id, and status verbatim', () => {
    expect(
      extractDuplicateCaptureEvidence('juicyway', {
        id: 'session-1',
        payment: {
          amount: 12.5,
          currency: 'USDC',
          id: 'payment-1',
          reference: 'BAC-JUICY',
          status: 'Succeeded',
        },
        status: 'completed',
      })
    ).toEqual({
      providerAmount: 12.5,
      providerReference: 'payment-1',
      providerStatus: 'Succeeded',
    });
  });

  it('returns null when the Paystack response has no charge id', () => {
    expect(
      extractDuplicateCaptureEvidence('paystack', {
        amount: 5829060,
        status: 'success',
      })
    ).toBeNull();
  });

  it('returns null when the Juicyway session has no settled payment', () => {
    expect(
      extractDuplicateCaptureEvidence('juicyway', {
        id: 'session-1',
        status: 'completed',
      })
    ).toBeNull();
  });

  it('returns null when the Korapay amount is unusable', () => {
    expect(
      extractDuplicateCaptureEvidence('korapay', {
        amount: 0,
        reference: 'BAC-KORA',
        status: 'success',
      })
    ).toBeNull();
  });
});
