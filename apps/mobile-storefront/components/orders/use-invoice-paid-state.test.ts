import { describe, expect, it, jest } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react-native';
import { useGuestInvoicePaidState } from './use-invoice-paid-state';

function mockTrackedOrder(paymentStatus: string, id = 'order-inv-1') {
  global.fetch = jest.fn(
    async () =>
      new Response(
        JSON.stringify({
          order: {
            id,
            order_number: 'ORD-INV-1',
            payment_status: paymentStatus,
            total: 50000,
          },
        }),
        { status: 200 }
      )
  ) as unknown as typeof fetch;
}

const baseParams = {
  orderId: 'order-inv-1',
  paymentMethod: 'invoice',
  trackingToken: 'track-inv-1',
  skip: false,
};

describe('useGuestInvoicePaidState', () => {
  it('resolves paid for a guest invoice settled externally', async () => {
    mockTrackedOrder('paid');

    const { result } = renderHook(() => useGuestInvoicePaidState(baseParams));

    await waitFor(() => expect(result.current).toBe(true));
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('track-order?token=track-inv-1'),
      expect.anything()
    );
  });

  it('stays unpaid while the invoice is still pending', async () => {
    mockTrackedOrder('pending');

    const { result } = renderHook(() => useGuestInvoicePaidState(baseParams));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current).toBe(false);
  });

  it('resets paid when the route swaps to a different unpaid invoice', async () => {
    mockTrackedOrder('paid', 'order-inv-1');

    const { result, rerender } = renderHook(
      ({
        orderId,
        trackingToken,
      }: {
        orderId: string;
        trackingToken: string;
      }) =>
        useGuestInvoicePaidState({
          ...baseParams,
          orderId,
          trackingToken,
        }),
      { initialProps: { orderId: 'order-inv-1', trackingToken: 'track-inv-1' } }
    );
    await waitFor(() => expect(result.current).toBe(true));

    // Same-route navigation to another invoice: the pending lookup must
    // clear the previous order's paid flag instead of presenting the
    // unpaid order as paid.
    mockTrackedOrder('pending', 'order-inv-2');
    rerender({ orderId: 'order-inv-2', trackingToken: 'track-inv-2' });

    await waitFor(() => expect(result.current).toBe(false));
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('track-order?token=track-inv-2'),
      expect.anything()
    );
  });

  it('skips the lookup when the receipt query already confirmed paid', () => {
    const fetchSpy = jest.fn(async () => new Response('{}', { status: 200 }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useGuestInvoicePaidState({ ...baseParams, skip: true })
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current).toBe(false);
  });
});
