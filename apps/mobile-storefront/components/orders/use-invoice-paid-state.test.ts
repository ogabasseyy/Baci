import { describe, expect, it, jest } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react-native';
import { useGuestInvoicePaidState } from './use-invoice-paid-state';

function mockTrackedOrder(
  paymentStatus: string,
  id = 'order-inv-1',
  extra: Record<string, unknown> = {}
) {
  global.fetch = jest.fn(
    async () =>
      new Response(
        JSON.stringify({
          order: {
            id,
            order_number: 'ORD-INV-1',
            payment_status: paymentStatus,
            total: 50000,
            ...extra,
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

    await waitFor(() => expect(result.current.status).toBe('paid'));
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
    expect(result.current.status).toBe('unpaid');
  });

  it('retries a failed lookup before accepting unpaid presentation', async () => {
    const paidResponse = () =>
      new Response(
        JSON.stringify({
          order: {
            id: 'order-inv-1',
            order_number: 'ORD-INV-1',
            payment_status: 'paid',
            total: 50000,
          },
        }),
        { status: 200 }
      );
    // First attempt fails transiently (transport/timeout); the retry
    // observes the externally-paid order.
    global.fetch = jest
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce(paidResponse()) as unknown as typeof fetch;

    const { result } = renderHook(() => useGuestInvoicePaidState(baseParams));

    await waitFor(() => expect(result.current.status).toBe('paid'));
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('stays unpaid when the lookup keeps failing', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useGuestInvoicePaidState(baseParams));

    await waitFor(() =>
      expect((global.fetch as jest.Mock).mock.calls.length).toBe(2)
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.status).toBe('unpaid');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('stays unresolved after failed lookups so a refunded order is never guessed unpaid', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useGuestInvoicePaidState(baseParams));

    await waitFor(() =>
      expect((global.fetch as jest.Mock).mock.calls.length).toBe(2)
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Both attempts failed: the status is a guess, not an answer. The
    // screen must withhold authoritative presentation and success side
    // effects rather than bless guessed-unpaid for an order that may in
    // fact be refunded.
    expect(result.current).toEqual({ status: 'unpaid', isResolved: false });
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
    await waitFor(() => expect(result.current.status).toBe('paid'));

    // Same-route navigation to another invoice: the pending lookup must
    // clear the previous order's paid flag instead of presenting the
    // unpaid order as paid.
    mockTrackedOrder('pending', 'order-inv-2');
    rerender({ orderId: 'order-inv-2', trackingToken: 'track-inv-2' });

    await waitFor(() => expect(result.current.status).toBe('unpaid'));
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
    expect(result.current.status).toBe('unpaid');
  });

  it('resolves paid for a guest pay-for-me order settled externally', async () => {
    mockTrackedOrder('paid');

    const { result } = renderHook(() =>
      useGuestInvoicePaidState({ ...baseParams, paymentMethod: 'payforme' })
    );

    await waitFor(() => expect(result.current.status).toBe('paid'));
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('track-order?token=track-inv-1'),
      expect.anything()
    );
  });

  it('stays unpaid while the pay-for-me request is still open', async () => {
    mockTrackedOrder('pending');

    const { result } = renderHook(() =>
      useGuestInvoicePaidState({ ...baseParams, paymentMethod: 'payforme' })
    );

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.status).toBe('unpaid');
  });

  it('resolves refunded for a previously-paid guest invoice instead of unpaid', async () => {
    mockTrackedOrder('refunded');

    const { result } = renderHook(() => useGuestInvoicePaidState(baseParams));

    // A refunded invoice must never present proforma/request copy: the
    // distinct outcome lets the success screen render reconciliation or
    // commercial-document state.
    await waitFor(() => expect(result.current.status).toBe('refunded'));
    expect(result.current.isResolved).toBe(true);
  });

  it.each([
    'cancelled',
    'canceled',
  ])('resolves %s for a cancelled guest invoice instead of unpaid', async (status) => {
    // A cancelled tracked order cannot be fulfilled: terminal
    // non-payable, never proforma/request copy with live payment
    // instructions — even while payment_status still reads pending.
    mockTrackedOrder('pending', 'order-inv-1', { status });

    const { result } = renderHook(() => useGuestInvoicePaidState(baseParams));

    await waitFor(() => expect(result.current.status).toBe('cancelled'));
    expect(result.current.isResolved).toBe(true);
  });

  it('resolves credited for a wallet-covered guest invoice instead of unpaid', async () => {
    mockTrackedOrder('unpaid', 'order-inv-1', { amount_paid: 20000 });

    const { result } = renderHook(() => useGuestInvoicePaidState(baseParams));

    // Pre-gateway credit with an unreconciled status: commercial
    // presentation like partially_paid, never proforma, never
    // reconciliation.
    await waitFor(() => expect(result.current.status).toBe('credited'));
    expect(result.current.isResolved).toBe(true);
  });

  it('reports unresolved until the token lookup settles', async () => {
    let resolveFetch!: (response: Response) => void;
    global.fetch = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useGuestInvoicePaidState(baseParams));

    // The lookup is in flight: screens must withhold purchase-success
    // side effects until the status is authoritative.
    expect(result.current).toEqual({ status: 'unpaid', isResolved: false });

    resolveFetch(
      new Response(
        JSON.stringify({
          order: {
            id: 'order-inv-1',
            order_number: 'ORD-INV-1',
            payment_status: 'refunded',
            total: 50000,
          },
        }),
        { status: 200 }
      )
    );
    await waitFor(() =>
      expect(result.current).toEqual({ status: 'refunded', isResolved: true })
    );
  });

  it('reports resolved synchronously when no lookup is needed', () => {
    const fetchSpy = jest.fn(async () => new Response('{}', { status: 200 }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useGuestInvoicePaidState({ ...baseParams, paymentMethod: 'paystack' })
    );

    // Non-deferred methods never look up: side effects must not stall.
    expect(result.current).toEqual({ status: 'unpaid', isResolved: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips the lookup for immediate-settlement methods', () => {
    const fetchSpy = jest.fn(async () => new Response('{}', { status: 200 }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useGuestInvoicePaidState({ ...baseParams, paymentMethod: 'paystack' })
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.status).toBe('unpaid');
  });
});
