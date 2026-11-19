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

describe('terminal UBA delivery recovery edge cases', () => {
  it('continues the existing order without requesting a new order or cancellation', async () => {
    const { context } = reviewedDelivery('door');
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    const { result } = renderHook(() => useCheckoutOrderSubmission(context));

    await act(async () => result.current.handlePlaceOrder());

    expect(submitPreparedCheckout).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
  });

  it('cancels the previous review when the delivery method changes', async () => {
    const { context } = reviewedDelivery('door');
    context.delivery.method = 'pickup_station';
    const request = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true, cancelled: true }))
    );
    vi.stubGlobal('fetch', request);
    const { result } = renderHook(() => useCheckoutOrderSubmission(context));

    await act(async () => result.current.handlePlaceOrder());

    expect(request).toHaveBeenCalledOnce();
    expect(context.order.clearPending).toHaveBeenCalledOnce();
    expect(submitPreparedCheckout).not.toHaveBeenCalled();
  });

  it('keeps the fence if a changed review has a live payment', async () => {
    const { context } = reviewedDelivery('door');
    context.contact.lastName = 'Changed';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 409 }))
    );
    const { result } = renderHook(() => useCheckoutOrderSubmission(context));

    await act(async () => result.current.handlePlaceOrder());

    expect(context.order.clearPending).not.toHaveBeenCalled();
    expect(submitPreparedCheckout).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Order still processing' })
    );
  });

  it('keeps the fence when the selected saved address is unavailable', async () => {
    const { context } = reviewedDelivery('door');
    context.delivery.session.address.isNewMode = false;
    context.delivery.session.address.selectedId = 123;
    const { result } = renderHook(() => useCheckoutOrderSubmission(context));

    await act(async () => result.current.handlePlaceOrder());

    expect(context.order.clearPending).not.toHaveBeenCalled();
    expect(submitPreparedCheckout).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Previous UBA checkout needs attention',
      })
    );
  });

  it('keeps the fence when the payment option is unavailable', async () => {
    const { context } = reviewedDelivery('door');
    context.payment.redvaultAvailable = false;
    const { result } = renderHook(() => useCheckoutOrderSubmission(context));

    await act(async () => result.current.handlePlaceOrder());

    expect(context.order.clearPending).not.toHaveBeenCalled();
    expect(submitPreparedCheckout).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Payment Unavailable' })
    );
  });

  it.each([
    { selected: 'mrate_rate-1', continues: true },
    { selected: 'mrate_rate-2', continues: false },
  ])('distinguishes the reviewed merchant rate from a different selection', async ({
    selected,
    continues,
  }) => {
    const { context, fingerprint } = reviewedDelivery('door');
    const fields = JSON.parse(fingerprint.slice('uba_redvault:'.length));
    const merchantFingerprint = `uba_redvault:${JSON.stringify({
      ...fields,
      shippingProvider: '',
      merchantRateId: 'rate-1',
    })}`;
    const pending = context.order.pending;
    const ready = context.payment.session.redvault.orderReady;
    if (!pending?.redvaultReview || !ready)
      throw new Error('Missing reviewed order');
    const updatedReady = { ...ready, checkoutFingerprint: merchantFingerprint };
    context.order.pending = {
      ...pending,
      checkoutFingerprint: merchantFingerprint,
      redvaultReview: { ...pending.redvaultReview, ready: updatedReady },
    };
    context.payment.session.redvault.orderReady = updatedReady;
    context.delivery.session.quotes.selectedId = selected;
    const request = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true, cancelled: true }))
    );
    vi.stubGlobal('fetch', request);
    const { result } = renderHook(() => useCheckoutOrderSubmission(context));

    await act(async () => result.current.handlePlaceOrder());

    if (continues) {
      expect(submitPreparedCheckout).toHaveBeenCalledOnce();
      expect(request).not.toHaveBeenCalled();
    } else {
      expect(submitPreparedCheckout).not.toHaveBeenCalled();
      expect(request).toHaveBeenCalledOnce();
      expect(context.order.clearPending).toHaveBeenCalledOnce();
    }
  });
});
