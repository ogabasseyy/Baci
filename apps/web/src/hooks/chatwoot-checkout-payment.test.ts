import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  initializeChatwootCheckoutBankTransfer,
  readChatwootCheckoutPaymentStatus,
} from './chatwoot-checkout-payment';
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

describe('readChatwootCheckoutPaymentStatus', () => {
  const read = (
    issuedAt = Date.now(),
    trackingToken: string | null = 'track-1'
  ) =>
    readChatwootCheckoutPaymentStatus({
      requestId: 'status-1',
      orderId: 'order-1',
      trackingToken,
      merchantSlug: 'store',
      issuedAt,
    });
  const track = (order: Record<string, unknown> | null) =>
    stubCheckoutFetch({
      '/api/storefront/orders/track-order': () => ({ body: { order } }),
    });

  it('reports paid, pending and terminal states for the created order', async () => {
    track({ id: 'order-1', payment_status: 'paid' });
    expect(await read()).toEqual({ requestId: 'status-1', status: 'paid' });
    track({ id: 'order-1', payment_status: 'pending' });
    expect(await read()).toEqual({ requestId: 'status-1', status: 'pending' });
    track({ id: 'order-1', payment_status: 'failed' });
    expect(await read()).toEqual({
      requestId: 'status-1',
      status: 'unavailable',
    });
  });

  it('is unavailable for another order, a missing token or an expired window', async () => {
    track({ id: 'other', payment_status: 'paid' });
    expect(await read()).toMatchObject({ status: 'unavailable' });
    const { fetchMock } = track({ id: 'order-1', payment_status: 'paid' });
    expect(await read(Date.now(), null)).toMatchObject({
      status: 'unavailable',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    track({ id: 'order-1', payment_status: 'pending' });
    expect(await read(Date.now() - 91 * 60 * 1000)).toMatchObject({
      status: 'unavailable',
    });
  });
});
