import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeChatwootCheckoutBankTransfer } from './chatwoot-checkout-payment';
import {
  checkoutPlaceRequest,
  dvaReady,
  stubCheckoutFetch,
} from './chatwoot-checkout-test-fixtures';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const init = () =>
  initializeChatwootCheckoutBankTransfer({
    merchantId: 'merchant-1',
    orderId: 'order-1',
    trackingToken: 'track-1',
    customer: checkoutPlaceRequest.customer,
    address: checkoutPlaceRequest.address,
  });

describe('initializeChatwootCheckoutBankTransfer', () => {
  it('requests a Paystack dedicated account and returns bank details', async () => {
    const { calls } = stubCheckoutFetch({
      '/api/payments/initialize': () => dvaReady,
    });

    expect(await init()).toEqual({
      bank: {
        bankName: 'Wema Bank',
        accountNumber: '0123456789',
        accountName: 'Store / Ada Obi',
      },
      reference: 'ref-123',
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      gateway: 'paystack',
      payment_type: 'dva',
      order_id: 'order-1',
      tracking_token: 'track-1',
      billing_address: { country: 'NG', line1: '12 Admiralty Way' },
    });
  });

  it('returns null for an error or incomplete details', async () => {
    stubCheckoutFetch({
      '/api/payments/initialize': () => ({ status: 500, body: {} }),
    });
    expect(await init()).toBeNull();
    stubCheckoutFetch({
      '/api/payments/initialize': () => ({
        body: {
          success: true,
          reference: 'r',
          dva: { bank_name: 'B', account_number: '', account_name: 'N' },
        },
      }),
    });
    expect(await init()).toBeNull();
  });
});
