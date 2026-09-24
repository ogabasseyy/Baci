import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchStorefrontOrderData } from './fetch-storefront-order';
import { useInvoiceGeneratedCapture } from './use-invoice-generated-capture';

vi.mock('./fetch-storefront-order', () => ({
  fetchStorefrontOrderData: vi.fn(),
}));

vi.mock(
  '@/components/storefront/ogabassey/pages/checkout/capture-checkout-invoice-generated',
  () => ({ captureCheckoutInvoiceGenerated: vi.fn() })
);

import { captureCheckoutInvoiceGenerated } from '@/components/storefront/ogabassey/pages/checkout/capture-checkout-invoice-generated';

const mockFetchOrder = vi.mocked(fetchStorefrontOrderData);
const mockCapture = vi.mocked(captureCheckoutInvoiceGenerated);

function watchedOrder(overrides = {}) {
  return {
    id: 'order-1',
    order_number: 'BAC-1',
    items: [{ id: 'i-1', quantity: 2, price: 5000 }],
    subtotal: 10000,
    shipping_cost: 0,
    total: 10000,
    currency: 'NGN',
    payment_status: 'unpaid',
    payment_method: 'invoice',
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    lookupEmail: null,
    merchantSlug: 'test-store',
    onOrder: vi.fn(),
    order: watchedOrder(),
    orderId: 'order-1',
    orderToken: 'tok-1',
    ...overrides,
  };
}

describe('useInvoiceGeneratedCapture', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('captures immediately when the lookup already shows delivery', async () => {
    const props = input({
      order: watchedOrder({ notification_delivered: true }),
    });
    renderHook(() => useInvoiceGeneratedCapture(props));

    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', total: 10000 })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(mockFetchOrder).not.toHaveBeenCalled();
  });

  it('polls until terminal delivery lands, then captures once', async () => {
    const onOrder = vi.fn();
    mockFetchOrder
      .mockResolvedValueOnce(watchedOrder())
      .mockResolvedValueOnce(
        watchedOrder({ notification_delivered: true, total: 10000 })
      );
    renderHook(() => useInvoiceGeneratedCapture(input({ onOrder })));

    expect(mockCapture).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(onOrder).toHaveBeenCalledTimes(2);
    expect(mockCapture).toHaveBeenCalledTimes(1);
    // The lane stops after delivery: no further polling.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(mockFetchOrder).toHaveBeenCalledTimes(2);
  });

  it('never captures for a paid order', async () => {
    renderHook(() =>
      useInvoiceGeneratedCapture(
        input({ order: watchedOrder({ payment_status: 'paid' }) })
      )
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(mockCapture).not.toHaveBeenCalled();
    expect(mockFetchOrder).not.toHaveBeenCalled();
  });

  it('stops without capturing when the budget is exhausted', async () => {
    mockFetchOrder.mockResolvedValue(watchedOrder());
    renderHook(() => useInvoiceGeneratedCapture(input()));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12 * 5000 + 60_000);
    });

    expect(mockFetchOrder).toHaveBeenCalledTimes(12);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('does not reset the budget when refreshes replace the order object', async () => {
    mockFetchOrder.mockResolvedValue(watchedOrder());
    const { rerender } = renderHook(
      ({ order }) => useInvoiceGeneratedCapture(input({ order })),
      { initialProps: { order: watchedOrder() } }
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 5000);
      // Same primitives, new identity: the lane must not restart.
      rerender({ order: watchedOrder() });
      await vi.advanceTimersByTimeAsync(12 * 5000 + 60_000);
    });

    expect(mockFetchOrder).toHaveBeenCalledTimes(12);
    expect(mockCapture).not.toHaveBeenCalled();
  });
});
