import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/hooks/use-toast';
import { submitPreparedCheckout } from '../handlers/submit-prepared-checkout';
import { reviewedDelivery } from './terminal-redvault-review.test-support';
import { useCheckoutOrderSubmission } from './use-checkout-order-submission';

vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('../handlers/submit-prepared-checkout', () => ({
  submitPreparedCheckout: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('terminal shared-cart delivery review', () => {
  it.each([
    'door',
    'pickup_station',
  ] as const)('continues the reviewed %s order when its completed cart has no fresh quote', async (method) => {
    const { context, fingerprint } = reviewedDelivery(method);
    const { result } = renderHook(() => useCheckoutOrderSubmission(context));

    await act(async () => result.current.handlePlaceOrder());

    expect(toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Select Delivery Option' })
    );
    expect(submitPreparedCheckout).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        identity: expect.objectContaining({ checkoutFingerprint: fingerprint }),
      }),
      { redvaultPreparedOnly: true }
    );
    expect(context.order.clearPending).not.toHaveBeenCalled();
  });

  it.each([
    'door',
    'pickup_station',
  ] as const)('cancels the reviewed %s order after contact changes without a fresh quote', async (method) => {
    const { context } = reviewedDelivery(method);
    context.contact.lastName = 'Changed';
    const cancelRequest = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true, cancelled: true }), {
          status: 200,
        })
    );
    vi.stubGlobal('fetch', cancelRequest);
    const { result } = renderHook(() => useCheckoutOrderSubmission(context));

    await act(async () => result.current.handlePlaceOrder());

    expect(cancelRequest).toHaveBeenCalledOnce();
    expect(context.order.clearPending).toHaveBeenCalledOnce();
    expect(submitPreparedCheckout).not.toHaveBeenCalled();
  });

  it('does not continue the old door order after its delivery address changes', async () => {
    const { context } = reviewedDelivery('door');
    context.delivery.newAddressStreet = '2 Changed St';
    const cancelRequest = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true, cancelled: true }), {
          status: 200,
        })
    );
    vi.stubGlobal('fetch', cancelRequest);
    const { result } = renderHook(() => useCheckoutOrderSubmission(context));

    await act(async () => result.current.handlePlaceOrder());

    expect(cancelRequest).toHaveBeenCalledOnce();
    expect(context.order.clearPending).toHaveBeenCalledOnce();
    expect(submitPreparedCheckout).not.toHaveBeenCalled();
  });

  it('cancels the old review when payment method changes and no quote is available', async () => {
    const { context } = reviewedDelivery('door');
    context.payment.session.method = 'paystack';
    const cancelRequest = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true, cancelled: true }), {
          status: 200,
        })
    );
    vi.stubGlobal('fetch', cancelRequest);
    const { result } = renderHook(() => useCheckoutOrderSubmission(context));

    await act(async () => result.current.handlePlaceOrder());

    expect(cancelRequest).toHaveBeenCalledOnce();
    expect(context.order.clearPending).toHaveBeenCalledOnce();
    expect(submitPreparedCheckout).not.toHaveBeenCalled();
  });

  it('does not continue a different in-memory order than the stored review', async () => {
    const { context } = reviewedDelivery('door');
    const ready = context.payment.session.redvault.orderReady;
    if (!ready) throw new Error('Missing reviewed order');
    context.payment.session.redvault.orderReady = {
      ...ready,
      orderId: 'other-order',
    };
    const { result } = renderHook(() => useCheckoutOrderSubmission(context));

    await act(async () => result.current.handlePlaceOrder());

    expect(submitPreparedCheckout).not.toHaveBeenCalled();
    expect(context.order.clearPending).not.toHaveBeenCalled();
    expect(context.processing.releaseSubmission).toHaveBeenCalledOnce();
  });

  it('does not continue when the in-memory payment identity differs from the stored review', async () => {
    const { context } = reviewedDelivery('door');
    const ready = context.payment.session.redvault.orderReady;
    if (!ready) throw new Error('Missing reviewed order');
    context.payment.session.redvault.orderReady = {
      ...ready,
      customerEmail: 'other@example.com',
    };
    const { result } = renderHook(() => useCheckoutOrderSubmission(context));

    await act(async () => result.current.handlePlaceOrder());

    expect(submitPreparedCheckout).not.toHaveBeenCalled();
    expect(context.order.clearPending).not.toHaveBeenCalled();
    expect(context.processing.releaseSubmission).toHaveBeenCalledOnce();
  });

  it('releases a changed review after a lost cancellation response is verified', async () => {
    const { context } = reviewedDelivery('door');
    context.contact.lastName = 'Changed';
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, cancelled: false }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'order-1',
            merchant_id: 'merchant-1',
            payment_method: 'uba_redvault',
            payment_status: 'cancelled',
            shipping_status: 'cancelled',
            amount_paid: 0,
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal('fetch', request);
    const { result } = renderHook(() => useCheckoutOrderSubmission(context));

    await act(async () => result.current.handlePlaceOrder());
    expect(context.order.clearPending).not.toHaveBeenCalled();
    await act(async () => result.current.handlePlaceOrder());

    expect(context.order.clearPending).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledTimes(3);
    expect(String(request.mock.calls[2]?.[0])).toContain(
      'merchant_slug=ada-store'
    );
    expect(submitPreparedCheckout).not.toHaveBeenCalled();
  });
});
