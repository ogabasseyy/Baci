import { CHECKOUT_FUNNEL_EVENTS } from '@baci/shared/contracts';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureCheckoutFunnelEventOnce } from '@/lib/posthog/capture-checkout-funnel-event';
import { useBnplSettlementCapture } from './use-bnpl-settlement-capture';

vi.mock('@/lib/posthog/capture-checkout-funnel-event', () => ({
  captureCheckoutFunnelEventOnce: vi.fn(),
}));

const mockCapture = vi.mocked(captureCheckoutFunnelEventOnce);

function paidOrder() {
  return {
    id: 'order-1',
    order_number: 'BAC-1',
    items: [],
    subtotal: 20000,
    shipping_cost: 1500,
    total: 21500,
    currency: 'ngn',
    payment_status: 'paid',
    payment_method: 'klump',
  };
}

function input(overrides = {}) {
  return {
    bnplType: 'klump',
    orderId: 'order-1',
    order: paidOrder(),
    bnplReference: 'ref-7',
    orderToken: 'tok-1',
    ...overrides,
  };
}

describe('useBnplSettlementCapture', () => {
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

  it('captures the deferred conversion when the reference verifies paid', async () => {
    renderHook(() => useBnplSettlementCapture(input()));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/payments/verify?reference=ref-7&trackingToken=tok-1'
    );
    expect(mockCapture).toHaveBeenCalledWith(
      CHECKOUT_FUNNEL_EVENTS.paymentCompleted,
      'order-1',
      expect.objectContaining({
        payment_method: 'klump',
        payment_status: 'paid',
        reference: 'ref-7',
        total: 21500,
      })
    );
  });

  it('retries verification while the paid order stays unverified', async () => {
    // First verdict is a non-success (unconverged inventory or transient
    // failure): not a negative — the lane must retry on the slow lane.
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: false, orderId: 'order-1' }),
      })
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, orderId: 'order-1' }),
      });
    renderHook(() => useBnplSettlementCapture(input()));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockCapture).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockCapture).toHaveBeenCalledTimes(1);
  });

  it('stops retrying after the verify budget is spent', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: false, orderId: 'order-1' }),
    });
    renderHook(() => useBnplSettlementCapture(input()));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12 * 15000 + 15000);
    });

    expect(mockFetch).toHaveBeenCalledTimes(12);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('withholds capture without a reference or token to verify', async () => {
    const referenceLess = renderHook(() =>
      useBnplSettlementCapture(input({ bnplReference: null }))
    );
    const tokenLess = renderHook(() =>
      useBnplSettlementCapture(input({ orderToken: null }))
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
    referenceLess.unmount();
    tokenLess.unmount();
  });

  it('identity-gates the capture against a stale order from another route', async () => {
    renderHook(() => useBnplSettlementCapture(input({ orderId: 'order-2' })));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('skips capture inside a native BNPL WebView (shell owns attribution)', async () => {
    (window as { ReactNativeWebView?: unknown }).ReactNativeWebView = {};
    renderHook(() => useBnplSettlementCapture(input()));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockCapture).not.toHaveBeenCalled();
  });
});
