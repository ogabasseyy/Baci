import {
  CheckoutPage,
  expect,
  fireEvent,
  it,
  mockCaptureClientEvent,
  mockCheckoutSubmissionState,
  render,
  screen,
  useMerchantSafe,
  useRouter,
  vi,
  waitFor,
} from './checkout-page-test-support';

it.each([
  'REDVAULT_RECONCILIATION_REQUIRED',
  'REDVAULT_CAPTURE_HELD',
])('uses server availability and renders %s without a paid transition', async (code) => {
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
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) => {
      const url = String(input);
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
          order: { id: 'order-redvault', currency: 'NGN' },
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
        return Response.json({ code }, { status: 202 });
      }
      return Response.json({});
    });

  render(<CheckoutPage />);
  fireEvent.click(screen.getByRole('button', { name: /delivery method/i }));
  fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
  fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
  fireEvent.click(await screen.findByRole('radio', { name: /pay with uba/i }));
  fireEvent.click(
    screen
      .getAllByRole('button', { name: /place order/i })
      .find((button) => !button.hasAttribute('disabled')) as HTMLButtonElement
  );

  // The first submit creates the order and opens the REDVAULT review step;
  // confirming the review issues payment initialization.
  await waitFor(() => {
    expect(
      fetchMock.mock.calls.some(([url]) => String(url) === '/api/orders')
    ).toBe(true);
  });
  fireEvent.click(
    await screen.findByRole('button', { name: /review and continue to uba/i })
  );
  await waitFor(() => {
    expect(
      fetchMock.mock.calls.some(
        ([url]) => String(url) === '/api/payments/initialize'
      )
    ).toBe(true);
  });
  const orderCall = fetchMock.mock.calls.find(
    ([url]) => String(url) === '/api/orders'
  );
  expect(JSON.parse(String(orderCall?.[1]?.body))).toMatchObject({
    payment_method: 'uba_redvault',
  });
  const initialization = fetchMock.mock.calls.find(
    ([url]) => String(url) === '/api/payments/initialize'
  );
  expect(JSON.parse(String(initialization?.[1]?.body))).toMatchObject({
    gateway: 'paystack',
    payment_method: 'uba_redvault',
  });
  expect(screen.queryByText(/order success/i)).not.toBeInTheDocument();
  if (code === 'REDVAULT_RECONCILIATION_REQUIRED') {
    expect(screen.getByRole('status')).toHaveTextContent(
      /awaiting reconciliation/i
    );
    expect(screen.queryByText(/Payment received/)).not.toBeInTheDocument();
  } else {
    expect(screen.getByRole('alert')).toHaveTextContent(/Payment received/);
  }
  expect(vi.mocked(useRouter)().push).not.toHaveBeenCalled();
  expect(screen.getByText('₦4,762.50')).toBeInTheDocument();
  fetchMock.mockRestore();
});

it('records a payment start with the init reference when REDVAULT opens', async () => {
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
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) => {
      const url = String(input);
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
            total: 5000,
            order_number: 'ORD-RV-1',
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
        return Response.json({
          authorization_url: 'https://checkout.paystack.com/redvault',
          reference: 'rv-ref-1',
        });
      }
      return Response.json({});
    });

  try {
    render(<CheckoutPage />);
    fireEvent.click(screen.getByRole('button', { name: /delivery method/i }));
    fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
    fireEvent.click(
      screen.getByRole('button', { name: /continue to payment/i })
    );
    fireEvent.click(
      await screen.findByRole('radio', { name: /pay with uba/i })
    );
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
    fireEvent.click(
      await screen.findByRole('button', { name: /review and continue to uba/i })
    );

    // Successful initialization records the start with the init
    // reference — no jump from order_created to completion. (The
    // subsequent authorization redirect is jsdom-untestable here.)
    await waitFor(() => {
      expect(
        mockCaptureClientEvent.mock.calls.filter(
          ([event]) => event === 'payment_started'
        )
      ).toHaveLength(1);
    });
    const startedCalls = mockCaptureClientEvent.mock.calls.filter(
      ([event]) => event === 'payment_started'
    );
    expect(startedCalls).toHaveLength(1);
    // Full revenue value and number stamped at creation — never the
    // residual gateway due.
    expect(startedCalls[0]?.[1]).toEqual(
      expect.objectContaining({
        payment_method: 'uba_redvault',
        reference: 'rv-ref-1',
        total: 5000,
        order_number: 'ORD-RV-1',
      })
    );
  } finally {
    fetchMock.mockRestore();
  }
});
