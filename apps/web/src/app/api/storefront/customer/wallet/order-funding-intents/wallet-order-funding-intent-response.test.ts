import { describe, expect, it } from 'vitest';
import { CUSTOMER_NAME_REQUIRED_MESSAGE } from '@/lib/customer-wallet-payment-account-types';
import { formatIntentResult } from './wallet-order-funding-intent-response';

describe('wallet order funding intent responses', () => {
  it('serializes a successful intent result as 200 with account and intent fields', async () => {
    const response = formatIntentResult({
      kind: 'intent',
      account: {
        accountName: 'Ogabassey/Jane Doe',
        accountNumber: '1234567890',
        bankName: 'Wema Bank',
        bankSlug: 'wema-bank',
        consentedAt: '2026-05-21T10:00:00.000Z',
        currency: 'NGN',
        customerId: 'customer-1',
        id: 'wallet-account-1',
        merchantId: 'merchant-1',
        metadata: {},
        provider: 'paystack',
        providerAccountId: '97',
        providerCustomerCode: 'CUS_existing',
        providerSubaccountCode: 'ACCT_merchant123',
        status: 'active',
      },
      intent: {
        createdAt: '2026-05-21T10:00:00.000Z',
        currency: 'NGN',
        customerId: 'customer-1',
        debitedAmount: 0,
        excessAmount: 0,
        expectedAmount: 5000,
        expiresAt: '2026-05-21T11:00:00.000Z',
        fundedAmount: 0,
        id: 'intent-1',
        idempotencyKey: 'idem-1',
        lastGatewayReference: null,
        lastTransactionId: null,
        merchantId: 'merchant-1',
        orderId: 'order-1',
        provider: 'paystack',
        status: 'pending',
        targetOrderAmount: 5000,
        walletBalanceSnapshot: 0,
        walletPaymentAccountId: 'wallet-account-1',
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      account: {
        accountName: 'Ogabassey/Jane Doe',
        accountNumber: '1234567890',
        bankName: 'Wema Bank',
        provider: 'paystack',
      },
      intent: {
        currency: 'NGN',
        expectedAmount: 5000,
        expiresAt: '2026-05-21T11:00:00.000Z',
        fundedAmount: 0,
        id: 'intent-1',
        orderId: 'order-1',
        status: 'pending',
        targetOrderAmount: 5000,
      },
    });
  });

  it('returns an actionable 400 when customer names are missing', async () => {
    const response = formatIntentResult({
      code: 'CUSTOMER_NAME_REQUIRED',
      kind: 'fallback',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: 'CUSTOMER_NAME_REQUIRED',
      error: CUSTOMER_NAME_REQUIRED_MESSAGE,
      kind: 'fallback',
    });
  });
});
