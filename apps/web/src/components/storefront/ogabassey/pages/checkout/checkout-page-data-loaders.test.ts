import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadResumedCheckoutOrder,
  loadWalletBalance,
  requestDvaInitialization,
} from './checkout-page-data-loaders';

const fetchMock = vi.fn();

describe('checkout-page data loaders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('hydrates the resumed order and pre-fills the payment step', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          customer_name: 'Ada Lovelace',
          customer_email: 'ada@example.com',
          customer_phone: '+2348012345678',
          shipping_address: {
            address: '12 Station Road',
            state: 'Osun',
            city: 'Osogbo',
          },
        }),
        { status: 200 }
      )
    );
    const setCheckoutFields = vi.fn();
    const setPaymentTab = vi.fn();
    const setPaymentMethod = vi.fn();

    await loadResumedCheckoutOrder({
      resumeOrderId: 'order-1',
      resumeMerchantSlug: 'shop-1',
      resumeTrackingToken: 'track-1',
      resumeLookupEmail: null,
      preferredGateway: 'credpal',
      setIsLoadingResumedOrder: vi.fn(),
      setResumedOrder: vi.fn(),
      setCheckoutFields,
      setPaymentTab,
      setPaymentMethod,
      setResumeOrderError: vi.fn(),
    });

    expect(setCheckoutFields).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Ada',
        lastName: 'Lovelace',
        currentStep: 'payment',
      })
    );
    expect(setPaymentTab).toHaveBeenCalledWith('installments');
    expect(setPaymentMethod).toHaveBeenCalledWith('credpal');
  });

  it('auto-applies wallet credit when the balance is positive', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ balance: 2500 }), { status: 200 })
    );
    const setWalletBalance = vi.fn();
    const setPayWithWallet = vi.fn();

    await loadWalletBalance({
      merchantSlug: 'shop-1',
      signal: new AbortController().signal,
      setWalletLoading: vi.fn(),
      setWalletBalance,
      setPayWithWallet,
    });

    expect(setWalletBalance).toHaveBeenCalledWith(2500);
    expect(setPayWithWallet).toHaveBeenCalledWith(true);
  });

  it('returns the DVA on successful initialization', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          dva: { account_number: '1234567890' },
          reference: 'BAC-1',
        }),
        { status: 200 }
      )
    );

    const result = await requestDvaInitialization({
      merchantId: 'merchant-1',
      orderId: 'order-1',
      customerEmail: 'ada@example.com',
      customerName: 'Ada Lovelace',
      customerPhone: '+2348012345678',
      billingAddress: { line1: '12 Station Road', city: 'Osogbo', country: 'NG' },
      orderCurrency: 'NGN',
    });

    expect(result).toEqual({
      dva: { account_number: '1234567890' },
      reference: 'BAC-1',
    });
  });

  it('throws when DVA initialization is rejected', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'nope' }), { status: 400 })
    );

    await expect(
      requestDvaInitialization({
        merchantId: 'merchant-1',
        orderId: 'order-1',
        customerEmail: 'ada@example.com',
        customerName: 'Ada Lovelace',
        customerPhone: '+2348012345678',
        billingAddress: {
          line1: '12 Station Road',
          city: 'Osogbo',
          country: 'NG',
        },
        orderCurrency: 'NGN',
      })
    ).rejects.toThrow('nope');
  });
});
