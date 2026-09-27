import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchStorefrontOrderData } from './fetch-storefront-order';
import { usePayformeHandoffRefresh } from './use-payforme-handoff-refresh';

vi.mock('./fetch-storefront-order', () => ({
  fetchStorefrontOrderData: vi.fn(),
}));

const mockFetchOrder = vi.mocked(fetchStorefrontOrderData);

function refreshedOrder(overrides = {}) {
  return {
    id: 'order-1',
    order_number: 'BAC-1',
    items: [],
    subtotal: 20000,
    shipping_cost: 0,
    total: 20000,
    payment_status: 'invoice',
    payment_method: 'payforme',
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    lookupEmail: null,
    merchantSlug: 'test-store',
    onOrder: vi.fn(),
    orderId: 'order-1',
    orderToken: 'tok-1',
    shouldRefresh: true,
    ...overrides,
  };
}

describe('usePayformeHandoffRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('does not poll when the handoff already has bank details', async () => {
    renderHook(() =>
      usePayformeHandoffRefresh(input({ shouldRefresh: false }))
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(mockFetchOrder).not.toHaveBeenCalled();
  });

  it('refetches until the retry-provisioned account arrives, then stops', async () => {
    const onOrder = vi.fn();
    mockFetchOrder.mockResolvedValueOnce(refreshedOrder()).mockResolvedValue(
      refreshedOrder({
        virtual_account: {
          account_name: 'BACIPAY/ADA',
          account_number: '0123456789',
          bank_name: 'Wema',
        },
      })
    );

    renderHook(() => usePayformeHandoffRefresh(input({ onOrder })));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(onOrder).toHaveBeenCalledTimes(1);
    expect(mockFetchOrder).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(onOrder).toHaveBeenCalledTimes(2);

    // The account arrived: no further polls.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(mockFetchOrder).toHaveBeenCalledTimes(2);
    expect(onOrder).toHaveBeenCalledTimes(2);
  });

  it('stops polling once the order is paid', async () => {
    const onOrder = vi.fn();
    mockFetchOrder.mockResolvedValue(
      refreshedOrder({ payment_status: 'paid' })
    );

    renderHook(() => usePayformeHandoffRefresh(input({ onOrder })));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(mockFetchOrder).toHaveBeenCalledTimes(1);
    expect(onOrder).toHaveBeenCalledTimes(1);
  });

  it('gives up after the attempt budget', async () => {
    const onOrder = vi.fn();
    mockFetchOrder.mockResolvedValue(refreshedOrder());

    renderHook(() => usePayformeHandoffRefresh(input({ onOrder })));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12 * 5000 + 30_000);
    });

    expect(mockFetchOrder).toHaveBeenCalledTimes(12);
    expect(onOrder).toHaveBeenCalledTimes(12);
  });
});
