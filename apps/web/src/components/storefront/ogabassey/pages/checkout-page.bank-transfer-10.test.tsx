import {
  CheckoutPage,
  expect,
  fireEvent,
  it,
  mockCheckoutSubmissionState,
  render,
  screen,
  useMerchantSafe,
  usePersistedState,
  vi,
  waitFor,
} from './checkout-page-test-support';

it('attaches the guest checkout to the new account before REDVAULT initialization', async () => {
  mockCheckoutSubmissionState();
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
  const sequence: string[] = [];
  const rpcMock = vi.fn(async (fn: string) => {
    sequence.push(`rpc:${fn}`);
    return { data: true, error: null };
  });
  const { createClient } = await import('@/lib/supabase/client');
  vi.mocked(createClient).mockReturnValue({
    auth: {
      getUser: vi.fn(),
      getSession: vi.fn(async () => ({
        data: { session: { user: { id: 'new-user' } } },
        error: null,
      })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signUp: vi.fn(async () => ({
        data: { session: { user: { id: 'new-user' } } },
        error: null,
      })),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
    rpc: rpcMock,
  } as unknown as ReturnType<typeof createClient>);
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) => {
      const url = String(input);
      sequence.push(`fetch:${url}`);
      if (url.startsWith('/api/payments/redvault/availability')) {
        return Response.json({ available: true, reason: 'reviewed' });
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
          order: {
            id: 'order-redvault',
            currency: 'NGN',
            tracking_token: 'track-redvault',
          },
          redvault: {
            quote: {
              product_subtotal_kobo: 500_000,
              eligible_subtotal_kobo: 500_000,
              discount_kobo: 25_000,
              assurance_fee_kobo: 0,
              ineligible_subtotal_kobo: 0,
              tax_kobo: 750,
              shipping_kobo: 500,
              gift_wrapping_kobo: 0,
              payable_kobo: 476_250,
              mixed_basket: false,
            },
          },
        });
      }
      if (url === '/api/payments/initialize') {
        return Response.json(
          { code: 'REDVAULT_RECONCILIATION_REQUIRED' },
          { status: 202 }
        );
      }
      return Response.json({});
    });

  render(<CheckoutPage />);
  fireEvent.click(screen.getByRole('button', { name: /delivery method/i }));
  fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
  fireEvent.click(screen.getByRole('button', { name: /contact information/i }));
  fireEvent.click(
    screen.getByRole('checkbox', { name: /save my information/i })
  );
  fireEvent.change(screen.getByPlaceholderText('Min. 6 characters'), {
    target: { value: 'guest-password-1' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: /continue to delivery/i })
  );
  fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
  fireEvent.click(await screen.findByRole('radio', { name: /pay with uba/i }));
  fireEvent.click(
    screen
      .getAllByRole('button', { name: /place order/i })
      .find((button) => !button.hasAttribute('disabled')) as HTMLButtonElement
  );
  await screen.findByRole('button', { name: /review and continue to uba/i });
  fireEvent.click(
    await screen.findByRole('button', { name: /review and continue to uba/i })
  );

  await waitFor(() => {
    expect(rpcMock).toHaveBeenCalledWith(
      'attach_redvault_guest_application_to_customer',
      { p_order_id: 'order-redvault', p_tracking_token: 'track-redvault' }
    );
  });
  await waitFor(() => {
    expect(
      sequence.some((entry) => entry === 'fetch:/api/payments/initialize')
    ).toBe(true);
  });
  expect(
    sequence.indexOf('rpc:attach_redvault_guest_application_to_customer')
  ).toBeLessThan(sequence.indexOf('fetch:/api/payments/initialize'));
  fetchMock.mockRestore();
});

it('still clears a non-REDVAULT snapshot when switching methods', async () => {
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
      orderId: 'order-card',
      merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      customerEmail: 'ada@example.com',
      customerPhone: '+2348000000000',
      checkoutFingerprint: 'fp',
      paymentMethod: 'card',
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
  fireEvent.click(await screen.findByRole('radio', { name: /pay with uba/i }));

  expect(clearPendingCheckoutOrder).toHaveBeenCalled();
  fetchMock.mockRestore();
});
