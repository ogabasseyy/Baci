import {
  CheckoutPage,
  expect,
  fireEvent,
  it,
  mockCheckoutSubmissionState,
  render,
  screen,
  useAuthSafe,
  useMerchantSafe,
  usePersistedState,
  vi,
  waitFor,
} from './checkout-page-test-support';

it('does not serialize an ordinary discount or wallet credit after selecting REDVAULT', async () => {
  mockCheckoutSubmissionState();
  vi.mocked(useAuthSafe).mockReturnValue({
    user: {
      id: 'customer-1',
      email: 'ada@example.com',
      user_metadata: {},
    },
  } as unknown as ReturnType<typeof useAuthSafe>);
  vi.mocked(useMerchantSafe).mockReturnValue({
    merchant: {
      id: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      slug: 'ogabassey',
      business_name: 'OgaBassey',
      country: 'NG',
      vat_registration_status: 'registered',
      vat_rate: 7.5,
    },
    basePath: '/ogabassey',
  } as unknown as ReturnType<typeof useMerchantSafe>);
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/payments/redvault/availability')) {
        return Response.json({ available: true, reason: 'reviewed' });
      }
      if (url.startsWith('/api/storefront/customer/wallet')) {
        return Response.json({ balance: 1_000 });
      }
      if (url === '/api/storefront/discount/validate') {
        return Response.json({
          valid: true,
          code: 'SAVE10',
          discount_type: 'fixed',
          discount_value: 1_000,
          discount_amount: 1_000,
        });
      }
      if (url.startsWith('/api/shipping/')) {
        return Response.json({
          quotes: { all: [] },
          states: ['Lagos'],
          locations: [],
        });
      }
      if (url === '/api/orders') {
        return Response.json({
          amountDueToGateway: 5_000,
          order: { id: 'order-redvault', currency: 'NGN' },
          redvault: {
            quote: {
              product_subtotal_kobo: 500_000,
              eligible_subtotal_kobo: 500_000,
              discount_kobo: 25_000,
              ineligible_subtotal_kobo: 0,
              tax_kobo: 375,
              shipping_kobo: 500,
              gift_wrapping_kobo: 0,
              payable_kobo: 475_875,
              mixed_basket: false,
            },
          },
        });
      }
      if (url === '/api/payments/initialize') {
        return Response.json(
          { code: 'REDVAULT_CAPTURE_HELD' },
          { status: 202 }
        );
      }
      return Response.json({});
    });

  render(<CheckoutPage />);
  await waitFor(() => {
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).startsWith('/api/storefront/customer/wallet')
      )
    ).toBe(true);
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Discount code' }), {
    target: { value: 'save10' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await screen.findByText('SAVE10');

  fireEvent.click(screen.getByRole('button', { name: /delivery method/i }));

  fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
  fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
  fireEvent.click(await screen.findByRole('radio', { name: /pay with uba/i }));
  fireEvent.click(
    screen
      .getAllByRole('button', { name: /place order/i })
      .find((button) => !button.hasAttribute('disabled')) as HTMLButtonElement
  );

  await waitFor(() => {
    expect(
      fetchMock.mock.calls.some(([url]) => String(url) === '/api/orders')
    ).toBe(true);
  });
  const orderCall = fetchMock.mock.calls.find(
    ([url]) => String(url) === '/api/orders'
  );
  const body = JSON.parse(String(orderCall?.[1]?.body));
  expect(body).toMatchObject({
    payment_method: 'uba_redvault',
    expected_total: 5_375,
    client_total: 5_375,
    use_wallet_credit: false,
    wallet_amount: 0,
  });
  expect(body).not.toHaveProperty('discount_code');
  fetchMock.mockRestore();
});

it('retains a stored REDVAULT fence when switching payment methods', async () => {
  mockCheckoutSubmissionState();
  vi.mocked(useMerchantSafe).mockReturnValue({
    merchant: {
      id: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      slug: 'ogabassey',
      business_name: 'OgaBassey',
      country: 'NG',
      vat_registration_status: 'registered',
      vat_rate: 7.5,
      feature_settings: {
        pay_on_delivery_enabled: true,
      },
    },
    basePath: '/ogabassey',
  } as unknown as ReturnType<typeof useMerchantSafe>);
  const clearPendingCheckoutOrder = vi.fn();
  vi.mocked(usePersistedState).mockReturnValue([
    {
      orderId: 'order-redvault',
      orderNumber: 'ORD-RV',
      trackingToken: 'track-rv',
      merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      customerEmail: 'ada@example.com',
      customerPhone: '+2348000000000',
      checkoutFingerprint: 'fp',
      paymentMethod: 'uba_redvault',
      amountDueToGateway: 5000,
      createdAt: new Date().toISOString(),
    },
    vi.fn(),
    clearPendingCheckoutOrder,
  ] as unknown as ReturnType<typeof usePersistedState>);
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/payments/redvault/availability')) {
        return Response.json({ available: true, reason: 'reviewed' });
      }
      return Response.json({ states: ['Lagos'], locations: [] });
    });

  render(<CheckoutPage />);
  fireEvent.click(screen.getByRole('button', { name: /delivery method/i }));
  fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
  fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
  fireEvent.click(
    await screen.findByRole('radio', { name: /pay on delivery/i })
  );
  fireEvent.click(await screen.findByRole('radio', { name: /pay with uba/i }));

  // Only the submit-time resolver (which validates server state) may
  // clear a REDVAULT fence — the method switch must retain it so an
  // indeterminate init cannot orphan a capturing order.
  expect(clearPendingCheckoutOrder).not.toHaveBeenCalled();
  fetchMock.mockRestore();
});
