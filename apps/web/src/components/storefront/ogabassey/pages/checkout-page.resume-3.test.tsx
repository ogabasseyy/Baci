import { mockResumeFetch } from './checkout-page-bnpl.test-support';
import {
  act,
  CheckoutPage,
  expect,
  it,
  mockCaptureCheckoutFunnelEventOnce,
  openCreditDirectCheckout,
  openCredPalCheckout,
  render,
  useMerchantSafe,
  useSearchParams,
  vi,
  waitFor,
} from './checkout-page-test-support';

it('labels resumed BNPL events with the stamped order currency', async () => {
  // Merchant still prices in NGN but the resumed order was stamped USD.
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams({
      orderId: 'ord-1',
      gateway: 'credpal',
      trackingToken: 'tok-123',
    }) as unknown as ReturnType<typeof useSearchParams>
  );
  const fetchMock = mockResumeFetch('USD');

  try {
    render(<CheckoutPage />);
    await waitFor(() => {
      expect(openCredPalCheckout).toHaveBeenCalled();
    });
    const config = vi.mocked(openCredPalCheckout).mock.calls[0]?.[0];

    act(() => {
      config?.onLoad?.();
    });
    await waitFor(() => {
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_started',
        expect.stringMatching(/^ord-1:/),
        expect.objectContaining({ currency: 'USD', total: 5750 })
      );
    });

    await act(async () => {
      await config?.onSuccess?.({
        order_no: 'cp-1',
        item: 'Test Product',
        amount: 5750,
        status: 'success',
        channel: 'credpal',
        customer: {
          full_name: 'Ada Buyer',
          email: 'ada@example.com',
          phone_no: '+2348123456789',
        },
        created_at: '2026-09-20T12:00:00.000Z',
      });
    });
    await waitFor(() => {
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_completed',
        'ord-1',
        expect.objectContaining({
          currency: 'USD',
          payment_status: 'paid',
          reference: 'cp-1',
        })
      );
    });
  } finally {
    fetchMock.mockRestore();
  }
});

it('does not fetch a resumed order until a merchant slug is available', async () => {
  vi.mocked(useMerchantSafe).mockReturnValue({
    merchant: {
      id: 'merchant-1',
      business_name: 'Test Store',
      vat_registration_status: 'registered',
      vat_rate: 7.5,
      country: 'NG',
    },
    basePath: '/ogabassey',
  } as unknown as ReturnType<typeof useMerchantSafe>);
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams({
      orderId: 'ord-1',
      gateway: 'credpal',
      trackingToken: 'tok-123',
    }) as unknown as ReturnType<typeof useSearchParams>
  );

  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false,
    json: async () => ({}),
  } as Response);

  render(<CheckoutPage />);

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/shipping/locations',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
  expect(
    fetchMock.mock.calls.some(
      ([url]) =>
        typeof url === 'string' &&
        url.startsWith('/api/storefront/orders/ord-1')
    )
  ).toBe(false);

  fetchMock.mockRestore();
});

it('does not auto-trigger direct checkout for unsupported resume gateways', async () => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams({
      orderId: 'ord-1',
      gateway: 'paystack',
      trackingToken: 'tok-123',
    }) as unknown as ReturnType<typeof useSearchParams>
  );

  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/storefront/orders/ord-1')) {
        return {
          ok: true,
          json: async () => ({
            id: 'ord-1',
            short_id: 'ORD-1',
            subtotal: 1000,
            shipping_cost: 0,
            total: 1000,
            customer_name: 'Ada Buyer',
            customer_email: 'ada@example.com',
            customer_phone: '+2348123456789',
            tracking_token: 'tok-123',
            shipping_address: { address: '', city: '', state: '' },
            items: [],
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({ states: [], locations: [] }),
        text: async () => '',
      } as Response;
    });

  render(<CheckoutPage />);

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/storefront/orders/ord-1?merchant_slug=ogabassey&token=tok-123',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
  expect(openCredPalCheckout).not.toHaveBeenCalled();
  expect(openCreditDirectCheckout).not.toHaveBeenCalled();

  fetchMock.mockRestore();
});
