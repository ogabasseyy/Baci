import { describe, expect, it } from 'vitest';
import { buildCommittedFailureCheckoutSnapshot } from './build-committed-failure-snapshot';

describe('buildCommittedFailureCheckoutSnapshot', () => {
  it('marks STORE_CREDIT_RETRY_REQUIRED checkpoints as retryable and freezes wallet amount', () => {
    const snapshot = buildCommittedFailureCheckoutSnapshot({
      failure: {
        code: 'STORE_CREDIT_RETRY_REQUIRED',
        orderId: 'order-1',
        orderNumber: 'ORD-1',
        trackingToken: 'tok-1',
        wallet: { amountUsed: 5000, newBalance: 1000 },
        amountDueToGateway: 12000,
      },
      merchantId: 'merchant-1',
      customerEmail: 'ada@example.test',
      customerPhone: '+2348000000000',
      fingerprint: JSON.stringify({ useWalletCredit: true, walletAmountUsed: 0 }),
      previousFingerprint: undefined,
      paymentMethod: 'paystack',
      fallbackTotal: 17000,
      now: () => '2026-11-19T00:00:00.000Z',
    });

    expect(snapshot).toEqual({
      orderId: 'order-1',
      orderNumber: 'ORD-1',
      trackingToken: 'tok-1',
      merchantId: 'merchant-1',
      customerEmail: 'ada@example.test',
      customerPhone: '+2348000000000',
      checkoutFingerprint: JSON.stringify({
        useWalletCredit: true,
        walletAmountUsed: 5000,
      }),
      paymentMethod: 'paystack',
      amountDueToGateway: 12000,
      walletAmountUsed: 5000,
      fundingUnresolved: true,
      fundingRetryable: true,
      createdAt: '2026-11-19T00:00:00.000Z',
    });
  });

  it('keeps STORE_CREDIT_REVIEW_REQUIRED non-retryable while preserving fundingUnresolved', () => {
    const snapshot = buildCommittedFailureCheckoutSnapshot({
      failure: {
        code: 'STORE_CREDIT_REVIEW_REQUIRED',
        orderId: 'order-2',
        wallet: null,
      },
      merchantId: 'merchant-1',
      customerEmail: 'ada@example.test',
      customerPhone: '+2348000000000',
      fingerprint: 'fp:card:0',
      paymentMethod: 'paystack',
      fallbackTotal: 17000,
      now: () => '2026-11-19T00:00:00.000Z',
    });

    expect(snapshot.fundingUnresolved).toBe(true);
    expect(snapshot.fundingRetryable).toBeUndefined();
    expect(snapshot.amountDueToGateway).toBe(17000);
  });
});
