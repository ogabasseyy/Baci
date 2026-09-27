import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutShippingQuotesOptions } from './checkout-shipping-quotes-options';
import { useCheckoutShippingQuotes } from './use-checkout-shipping-quotes';

function options(): CheckoutShippingQuotesOptions {
  return {
    isHydrated: true,
    merchantId: 'merchant-1',
    merchantCountry: 'NG',
    checkoutCart: [{ name: 'Phone', price: 1000, quantity: 1 }],
    checkoutCartCatalogSubtotal: 1000,
    quoteItemsFingerprint: 'phone:1:1000',
    deliveryCoordinates: null,
    persistedSelectedQuoteId: '',
    persistedSelectedProviderRateId: '',
    currentStep: 'delivery',
    setCurrentStep: vi.fn(),
    setCheckoutField: vi.fn(),
    setCheckoutFields: vi.fn(),
    setDeliveryMethod: vi.fn(),
    deliveryMethod: 'door',
    newAddressStreet: '1 Airport Road',
    newAddressState: 'Lagos',
    newAddressCity: 'Ikeja',
    customerPhone: '08012345678',
    firstName: 'Ada',
    lastName: 'Eze',
    customerEmail: 'ada@example.com',
    isNewAddressMode: true,
    addresses: [],
    selectedAddressId: 0,
  };
}
function response(id: string) {
  return Response.json({
    quotes: {
      all: [
        {
          id,
          carrierName: 'GIG Logistics',
          currency: 'NGN',
          displayName: 'Home Delivery',
          estimatedDays: 3,
          insuranceIncluded: true,
          pickupIncluded: true,
          price: 500,
          provider: 'GIGL',
          serviceTier: 'Standard',
        },
      ],
    },
  });
}
function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const mockFetch = vi.fn<typeof fetch>();

describe('useCheckoutShippingQuotes', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });
  afterEach(() => vi.unstubAllGlobals());
  it('waits for hydration before requesting quotes', async () => {
    mockFetch.mockResolvedValue(response('ready'));
    const input = options();
    const { result, rerender } = renderHook(
      (props) => useCheckoutShippingQuotes(props),
      { initialProps: { ...input, isHydrated: false } }
    );
    expect(mockFetch).not.toHaveBeenCalled();
    rerender(input);
    await waitFor(() =>
      expect(result.current.shippingQuotes[0]?.id).toBe('ready')
    );
    expect(mockFetch).toHaveBeenCalledOnce();
  });
  it('ignores a late response after the delivery address changes', async () => {
    const old = deferredResponse();
    const next = deferredResponse();
    mockFetch
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(next.promise);
    const input = options();
    const { result, rerender } = renderHook(
      (props) => useCheckoutShippingQuotes(props),
      { initialProps: input }
    );
    const signal = mockFetch.mock.calls[0][1]?.signal;
    rerender({ ...input, newAddressStreet: '2 Airport Road' });
    expect(signal?.aborted).toBe(true);
    expect(input.setCheckoutField).toHaveBeenCalledWith('selectedQuoteId', '');
    await act(async () => next.resolve(response('new')));
    await act(async () => old.resolve(response('old')));
    expect(result.current.shippingQuotes.map((quote) => quote.id)).toEqual([
      'new',
    ]);
    expect(result.current.isLoadingQuotes).toBe(false);
  });
  it('switches quote preference and cancels the old door request for station pickup', async () => {
    const old = deferredResponse();
    const next = deferredResponse();
    mockFetch
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(next.promise);
    const input = options();
    const { rerender } = renderHook(
      (props) => useCheckoutShippingQuotes(props),
      { initialProps: input }
    );
    const signal = mockFetch.mock.calls[0][1]?.signal;
    rerender({ ...input, deliveryMethod: 'pickup_station' });
    expect(signal?.aborted).toBe(true);
    expect(JSON.parse(String(mockFetch.mock.calls[1][1]?.body))).toMatchObject({
      deliveryPreference: 'pickup_station',
    });
    await act(async () => {
      next.resolve(response('pickup'));
      old.resolve(response('old'));
    });
  });
  it('requotes when the catalog subtotal changes even if cart identity is unchanged', async () => {
    mockFetch.mockImplementation(async () => response('quote'));
    const input = options();
    const { result, rerender } = renderHook(
      (props) => useCheckoutShippingQuotes(props),
      { initialProps: input }
    );
    await waitFor(() => expect(result.current.isLoadingQuotes).toBe(false));
    rerender({ ...input, checkoutCartCatalogSubtotal: 1500 });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(mockFetch.mock.calls[1][1]?.body))).toMatchObject({
      cart_subtotal: 1500,
    });
  });
  it('invalidates pending requests and clears coordinates when address input is reset', async () => {
    const pending = deferredResponse();
    mockFetch.mockReturnValueOnce(pending.promise);
    const input = options();
    const { result } = renderHook(() => useCheckoutShippingQuotes(input));
    const signal = mockFetch.mock.calls[0][1]?.signal;
    act(() =>
      result.current.resetQuotesForAddressChange({
        preserveDeliveryMethod: true,
      })
    );
    expect(signal?.aborted).toBe(true);
    expect(input.setCheckoutFields).toHaveBeenCalledWith({
      deliveryCoordinates: null,
    });
    expect(input.setDeliveryMethod).not.toHaveBeenCalled();
    await act(async () => pending.resolve(response('stale')));
    expect(result.current.shippingQuotes).toEqual([]);
  });
  it('aborts and rejects late quote state writes after unmount', async () => {
    const pending = deferredResponse();
    mockFetch.mockReturnValueOnce(pending.promise);
    const input = options();
    const { unmount } = renderHook(() => useCheckoutShippingQuotes(input));
    const signal = mockFetch.mock.calls[0][1]?.signal;
    vi.mocked(input.setCheckoutField).mockClear();
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve(response('late')));
    expect(input.setCheckoutField).not.toHaveBeenCalled();
  });
});
