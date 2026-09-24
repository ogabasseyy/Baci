import { describe, expect, it } from 'vitest';
import { buildCreditDirectVerificationPath } from './build-credit-direct-verification-path';

describe('buildCreditDirectVerificationPath', () => {
  it('builds the BNPL verification URL with the required identity', () => {
    expect(
      buildCreditDirectVerificationPath({
        orderId: 'order-1',
        merchantSlug: 'test-store',
      })
    ).toBe(
      '/checkout/bnpl?orderId=order-1&gateway=credit_direct&merchant_slug=test-store'
    );
  });

  it('carries the completion marker, tracking token, and email when present', () => {
    expect(
      buildCreditDirectVerificationPath({
        orderId: 'order-1',
        merchantSlug: 'test-store',
        completionMarker: {
          source: 'popup',
          transactionId: 'txn-1',
          storedAt: '2026-09-21T00:00:00.000Z',
        },
        trackingToken: 'track-1',
        customerEmail: 'buyer@example.com',
      })
    ).toBe(
      '/checkout/bnpl?orderId=order-1&gateway=credit_direct&merchant_slug=test-store&creditDirectCompletion=txn-1&trackingToken=track-1&email=buyer%40example.com'
    );
  });
});
