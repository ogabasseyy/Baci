import { describe, expect, it, jest } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react-native';
import { useReceiptDetail } from '@/hooks/use-receipts';
import { useDeferredOrderStatusAuthority } from './use-deferred-order-status-authority';

jest.mock('@/hooks/use-receipts', () => ({
  useReceiptDetail: jest.fn(),
}));

const mockUseReceiptDetail = jest.mocked(useReceiptDetail);

function mockGuestLookup(paymentStatus: string, status?: string) {
  global.fetch = jest.fn(
    async () =>
      new Response(
        JSON.stringify({
          order: {
            id: 'order-inv-1',
            order_number: 'ORD-INV-1',
            payment_status: paymentStatus,
            status: status ?? 'processing',
            total: 50000,
          },
        }),
        { status: 200 }
      )
  ) as unknown as typeof fetch;
}

const baseParams = {
  customer: null,
  needsDeferredStatus: true,
  orderId: 'order-inv-1',
  paymentMethod: 'invoice',
  trackingToken: 'track-inv-1',
};

describe('useDeferredOrderStatusAuthority', () => {
  it('withholds authority when the authenticated receipt request fails', async () => {
    // A failed receipt request (error => isSuccess false) must not render
    // the order as unpaid with side effects enabled, and the guest lookup
    // must not run for a signed-in customer.
    mockUseReceiptDetail.mockReturnValue({
      data: undefined,
      isSuccess: false,
    } as never);
    const fetchSpy = jest.fn(async () => new Response('{}', { status: 500 }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useDeferredOrderStatusAuthority({
        ...baseParams,
        customer: { id: 'c-1' },
      })
    );

    await waitFor(() =>
      expect(result.current.deferredStatusAuthoritative).toBe(false)
    );
    expect(result.current.isPaidOrder).toBe(false);
    // No successful lookup: no stored method to agree with (callers keep
    // the pre-resolution tone instead of a failed request's absence).
    expect(result.current.receiptPaymentMethod).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('grants authority on a successful authenticated receipt', () => {
    mockUseReceiptDetail.mockReturnValue({
      data: {
        payment_status: 'paid',
        payment_method: 'card',
        amount_paid: 50000,
      },
      isSuccess: true,
    } as never);
    const fetchSpy = jest.fn(async () => new Response('{}', { status: 500 }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useDeferredOrderStatusAuthority({
        ...baseParams,
        customer: { id: 'c-1' },
      })
    );

    expect(result.current.isPaidOrder).toBe(true);
    expect(result.current.deferredStatusAuthoritative).toBe(true);
    expect(result.current.receiptAmountPaid).toBe(50000);
    // Stored method for document-kind agreement (crafted route params
    // must not relabel the preview).
    expect(result.current.receiptPaymentMethod).toBe('card');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    { payment_status: 'cancelled', shipping_status: 'pending' },
    { payment_status: 'canceled', shipping_status: 'pending' },
    { payment_status: 'pending', shipping_status: 'cancelled' },
    { payment_status: 'pending', shipping_status: 'canceled' },
    { payment_status: 'Cancelled', shipping_status: 'pending' },
  ])('reports authenticated cancellation ($payment_status/$shipping_status)', ({
    payment_status,
    shipping_status,
  }) => {
    // Cancellation paths commonly set only shipping_status, and the
    // guest token lookup is skipped for signed-in shoppers — so the
    // receipt lookup is the only reporter on this path.
    mockUseReceiptDetail.mockReturnValue({
      data: {
        payment_status,
        shipping_status,
        payment_method: 'invoice',
        amount_paid: 0,
      },
      isSuccess: true,
    } as never);
    const fetchSpy = jest.fn(async () => new Response('{}', { status: 500 }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useDeferredOrderStatusAuthority({
        ...baseParams,
        customer: { id: 'c-1' },
      })
    );

    expect(result.current.isCancelledOrder).toBe(true);
    expect(result.current.isPaidOrder).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports guest cancellation through the token lookup', async () => {
    mockUseReceiptDetail.mockReturnValue({
      data: undefined,
      isSuccess: false,
    } as never);
    // Legacy rows keep payment pending on a cancelled order: the
    // tracking status is the cancellation signal on this path.
    mockGuestLookup('pending', 'cancelled');

    const { result } = renderHook(() =>
      useDeferredOrderStatusAuthority(baseParams)
    );

    await waitFor(() => expect(result.current.isCancelledOrder).toBe(true));
    expect(result.current.isPaidOrder).toBe(false);
  });

  it('resolves guests through the token lookup', async () => {
    mockUseReceiptDetail.mockReturnValue({
      data: undefined,
      isSuccess: false,
    } as never);
    mockGuestLookup('paid');

    const { result } = renderHook(() =>
      useDeferredOrderStatusAuthority(baseParams)
    );

    await waitFor(() => expect(result.current.isPaidOrder).toBe(true));
    await waitFor(() =>
      expect(result.current.deferredStatusAuthoritative).toBe(true)
    );
  });
});
