import { describe, expect, it, vi } from 'vitest';
import { initializeCheckoutDva } from './initialize-checkout-dva';

const base = {
  merchantId: 'merchant-1',
  customerEmail: 'customer@example.com',
  customerName: 'Ada Customer',
  customerPhone: '08000000000',
  checkoutFingerprint: 'fingerprint',
  billingAddress: { line1: '1 Main St', city: 'Lagos', country: 'NG' },
  currencyCode: 'NGN',
  paymentAmount: 4500,
  total: 5000,
  order: {
    id: 'order-1',
    order_number: 'BAC-1',
    tracking_token: 'tracking-token',
    total: 5000,
    currency: 'usd',
  },
};

describe('initializeCheckoutDva', () => {
  it('stores the stamped order currency and starts telemetry only after a DVA is ready', async () => {
    const setDvaData = vi.fn();
    const onDvaReady = vi.fn();
    const releaseSubmitLock = vi.fn();

    await initializeCheckoutDva({
      ...base,
      setDvaData,
      setDvaCountdown: vi.fn(),
      setIsProcessing: vi.fn(),
      setIsInitializingDva: vi.fn(),
      releaseSubmitLock,
      onDvaReady,
      onPaymentFailure: vi.fn(),
      onError: vi.fn(),
      requestDva: vi.fn(async () => ({
        dva: {
          account_number: '123',
          account_name: 'Baci',
          bank_name: 'Bank',
          bank_code: '001',
        },
        reference: 'dva-ref',
      })),
    });

    expect(setDvaData).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 4500,
        total: 5000,
        orderCurrency: 'USD',
        reference: 'dva-ref',
      })
    );
    expect(onDvaReady).toHaveBeenCalledWith('dva-ref');
    expect(releaseSubmitLock).toHaveBeenCalledOnce();
  });

  it('releases the submit lock and reports an initialization failure without a ready event', async () => {
    const onDvaReady = vi.fn();
    const onPaymentFailure = vi.fn();
    const onError = vi.fn();
    const releaseSubmitLock = vi.fn();

    await initializeCheckoutDva({
      ...base,
      setDvaData: vi.fn(),
      setDvaCountdown: vi.fn(),
      setIsProcessing: vi.fn(),
      setIsInitializingDva: vi.fn(),
      releaseSubmitLock,
      onDvaReady,
      onPaymentFailure,
      onError,
      requestDva: vi.fn(async () => {
        throw new Error('DVA unavailable');
      }),
    });

    expect(onDvaReady).not.toHaveBeenCalled();
    expect(onPaymentFailure).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(releaseSubmitLock).toHaveBeenCalledOnce();
  });
});
