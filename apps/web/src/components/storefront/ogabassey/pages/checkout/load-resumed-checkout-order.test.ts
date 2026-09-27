import { afterEach, expect, it, vi } from 'vitest';
import { loadResumedCheckoutOrder } from './load-resumed-checkout-order';

const params = () => ({
  resumeOrderId: 'order-1',
  resumeMerchantSlug: 'ogabassey',
  resumeTrackingToken: 'token-1',
  resumeLookupEmail: null,
  preferredGateway: 'credit_direct' as const,
  setIsLoadingResumedOrder: vi.fn(),
  setResumedOrder: vi.fn(),
  setCheckoutFields: vi.fn(),
  setPaymentTab: vi.fn(),
  setPaymentMethod: vi.fn(),
  setResumeOrderError: vi.fn(),
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('hydrates contact details and keeps a resumed BNPL order on the installments tab', async () => {
  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      id: 'order-1',
      customer_name: 'Ada Okon',
      customer_email: 'ada@example.com',
    })
  );
  vi.stubGlobal('fetch', fetch);
  const updates = params();
  await loadResumedCheckoutOrder(updates);
  expect(fetch).toHaveBeenCalledWith(
    '/api/storefront/orders/order-1?merchant_slug=ogabassey&token=token-1',
    { signal: undefined }
  );
  expect(updates.setCheckoutFields).toHaveBeenCalledWith(
    expect.objectContaining({
      firstName: 'Ada',
      lastName: 'Okon',
      currentStep: 'payment',
    })
  );
  expect(updates.setPaymentTab).toHaveBeenCalledWith('installments');
  expect(updates.setPaymentMethod).toHaveBeenCalledWith('credit_direct');
  expect(updates.setIsLoadingResumedOrder).toHaveBeenLastCalledWith(false);
});

it('leaves loading with a safe error when the order is unavailable', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('', { status: 404 }))
  );
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const updates = params();
  await loadResumedCheckoutOrder(updates);
  expect(updates.setResumeOrderError).toHaveBeenLastCalledWith(
    'Order not found. It may have been completed or expired.'
  );
  expect(updates.setCheckoutFields).not.toHaveBeenCalled();
  expect(updates.setIsLoadingResumedOrder).toHaveBeenLastCalledWith(false);
});
