import { CHECKOUT_FUNNEL_EVENTS } from '@baci/shared/contracts';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureCheckoutFunnelEventOnce } from '@/lib/posthog/capture-checkout-funnel-event';
import { fetchStorefrontOrderData } from './fetch-storefront-order';
import { useBnplSettlement } from './use-bnpl-settlement';

vi.mock('@/lib/posthog/capture-checkout-funnel-event', () => ({
  captureCheckoutFunnelEventOnce: vi.fn(),
}));

vi.mock('./fetch-storefront-order', () => ({
  fetchStorefrontOrderData: vi.fn(),
}));

const mockFetchOrder = vi.mocked(fetchStorefrontOrderData);
const mockCapture = vi.mocked(captureCheckoutFunnelEventOnce);

function pendingOrder() {
  return {
    id: 'order-1',
    order_number: 'BAC-1',
    items: [],
    subtotal: 20000,
    shipping_cost: 1500,
    total: 21500,
    currency: 'ngn',
    payment_status: 'pending',
    payment_method: 'klump',
  };
}

function input(overrides = {}) {
  return {
    checkoutType: 'klump',
    orderId: 'order-1',
    orderToken: 'tok-1',
    merchantSlug: 'test-store',
    referenceParam: null,
    credpalRefParam: null,
    loading: false,
    order: pendingOrder(),
    setOrder: vi.fn(),
    ...overrides,
  };
}

describe('useBnplSettlement', () => {
  const mockFetch = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, orderId: 'order-1' }),
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    delete (window as { ReactNativeWebView?: unknown }).ReactNativeWebView;
  });

  it('does not poll for non-pending-BNPL checkout types', async () => {
    renderHook(() => useBnplSettlement(input({ checkoutType: 'paystack' })));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(mockFetchOrder).not.toHaveBeenCalled();
  });

  it('does not poll while loading or without an order token', async () => {
    const loading = renderHook(() =>
      useBnplSettlement(input({ loading: true }))
    );
    const tokenless = renderHook(() =>
      useBnplSettlement(input({ orderToken: null }))
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(mockFetchOrder).not.toHaveBeenCalled();
    loading.unmount();
    tokenless.unmount();
  });

  it('polls the token-scoped order until it reads paid, then stops', async () => {
    const paid = { ...pendingOrder(), payment_status: 'paid' };
    mockFetchOrder
      .mockResolvedValueOnce({ ...pendingOrder() })
      .mockResolvedValue(paid);
    const setOrder = vi.fn();
    renderHook(() => useBnplSettlement(input({ setOrder })));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(mockFetchOrder).toHaveBeenCalledTimes(1);
    expect(mockFetchOrder).toHaveBeenCalledWith(
      'order-1',
      'test-store',
      'tok-1',
      null,
      expect.any(AbortSignal)
    );
    expect(setOrder).toHaveBeenCalledWith(
      expect.objectContaining({ payment_status: 'pending' })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(mockFetchOrder).toHaveBeenCalledTimes(2);
    expect(setOrder).toHaveBeenCalledWith(
      expect.objectContaining({ payment_status: 'paid' })
    );

    // Settled: no further polls even across the slow lane.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(mockFetchOrder).toHaveBeenCalledTimes(2);
  });

  it('captures the deferred conversion when the reference verifies paid', async () => {
    const paid = { ...pendingOrder(), payment_status: 'paid' };
    renderHook(() =>
      useBnplSettlement(
        input({ order: paid, referenceParam: 'ref-7', credpalRefParam: 'cp-9' })
      )
    );

    await act(async () => {});
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/payments/verify?reference=ref-7&trackingToken=tok-1'
      )
    );
    expect(mockCapture).toHaveBeenCalledWith(
      CHECKOUT_FUNNEL_EVENTS.paymentCompleted,
      'order-1',
      expect.objectContaining({
        payment_method: 'klump',
        reference: 'ref-7',
        total: 21500,
        currency: 'NGN',
      })
    );
  });

  it('accepts the credpalRef alias for settlement attribution', async () => {
    const paid = { ...pendingOrder(), payment_status: 'paid' };
    renderHook(() =>
      useBnplSettlement(
        input({
          checkoutType: 'credpal',
          order: paid,
          referenceParam: null,
          credpalRefParam: 'cp-txn-3',
        })
      )
    );

    await act(async () => {});
    expect(mockCapture).toHaveBeenCalledWith(
      CHECKOUT_FUNNEL_EVENTS.paymentCompleted,
      'order-1',
      expect.objectContaining({ reference: 'cp-txn-3' })
    );
  });

  it('withholds capture when the reference verifies as non-success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: false,
          status: 'pending',
          orderId: 'order-1',
        }),
    });
    const paid = { ...pendingOrder(), payment_status: 'paid' };
    renderHook(() =>
      useBnplSettlement(input({ order: paid, referenceParam: 'ref-7' }))
    );

    await act(async () => {});
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('withholds capture without a reference to verify', async () => {
    const paid = { ...pendingOrder(), payment_status: 'paid' };
    renderHook(() =>
      useBnplSettlement(
        input({ order: paid, referenceParam: null, credpalRefParam: null })
      )
    );

    await act(async () => {});
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('identity-gates the capture against stale orders from another route', () => {
    const stalePaid = { ...pendingOrder(), payment_status: 'paid' };
    renderHook(() =>
      useBnplSettlement(input({ orderId: 'order-2', order: stalePaid }))
    );

    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('skips capture inside a native BNPL WebView (shell owns attribution)', () => {
    (window as { ReactNativeWebView?: unknown }).ReactNativeWebView = {};
    const paid = { ...pendingOrder(), payment_status: 'paid' };
    renderHook(() => useBnplSettlement(input({ order: paid })));

    expect(mockCapture).not.toHaveBeenCalled();
  });
});
