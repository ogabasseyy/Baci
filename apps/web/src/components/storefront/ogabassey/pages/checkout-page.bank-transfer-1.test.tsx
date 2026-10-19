import {
  CheckoutPage,
  cleanup,
  expect,
  fireEvent,
  it,
  mockCaptureClientEvent,
  mockCheckoutSubmissionState,
  render,
  screen,
  toast,
  useCart,
  useMerchantSafe,
  usePersistedForm,
  vi,
  waitFor,
} from './checkout-page-test-support';

it('emits payment_started only after bank-transfer initialization succeeds', async () => {
  const startedEvents: unknown[][] = [];
  const failedEvents: unknown[][] = [];
  mockCaptureClientEvent.mockImplementation((...args: unknown[]) => {
    if (args[0] === 'payment_started') startedEvents.push(args);
    if (args[0] === 'payment_failed') failedEvents.push(args);
  });
  const merchant = {
    id: 'merchant-1',
    slug: 'ogabassey',
    business_name: 'Test Store',
    country: 'NG',
    vat_registration_status: 'registered',
    vat_rate: 7.5,
    paystack_subaccount_code: 'ACCT_test123',
    feature_settings: {
      bank_transfer_enabled: true,
      wallet_paystack_dva_enabled: true,
    },
  };
  const paymentForm = {
    values: {
      firstName: 'Ada',
      lastName: 'Buyer',
      customerEmail: 'ada@example.com',
      customerPhone: '+2348123456789',
      newAddressStreet: '2 Olaide Tomori Street',
      newAddressState: 'Lagos',
      newAddressCity: 'Ikeja',
      currentStep: 'payment',
      completedSteps: { contact: true, delivery: true },
    },
    setValue: vi.fn(),
    setValues: vi.fn(),
    clear: vi.fn(),
  } as unknown as ReturnType<typeof usePersistedForm>;
  let dvaSucceeds = false;

  const submitBankTransfer = async () => {
    vi.mocked(useCart).mockReturnValue({
      cart: [
        {
          id: 'item-1',
          name: 'Test Product',
          price: 5000,
          quantity: 1,
          image: '',
          slug: 'test-product',
        },
      ],
      cartTotal: 5000,
      clearCart: vi.fn(),
      isHydrated: true,
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant,
      basePath: '/ogabassey',
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(usePersistedForm).mockReturnValue(paymentForm);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, _init) => {
        if (String(input) === '/api/payments/initialize') {
          if (!dvaSucceeds) {
            return {
              ok: false,
              json: async () => ({ error: 'declined' }),
            } as Response;
          }
          return {
            ok: true,
            json: async () => ({
              success: true,
              dva: {
                account_number: '1234567890',
                account_name: 'Test',
                bank_name: 'Test Bank',
              },
              reference: 'dva-ref-1',
            }),
          } as Response;
        }
        if (String(input) === '/api/orders') {
          return {
            ok: true,
            json: async () => ({
              amountDueToGateway: 5000,
              order: {
                id: 'order-dva',
                order_number: 'ORD-DVA',
                total: 5000,
                payment_status: 'pending',
                tracking_token: 'track-1',
              },
              wallet: null,
            }),
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ states: [], locations: [] }),
        } as Response;
      });

    render(<CheckoutPage />);
    fireEvent.click(screen.getByRole('button', { name: /delivery method/i }));
    fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
    fireEvent.click(
      screen.getByRole('button', { name: /continue to payment/i })
    );
    const paymentRadio = screen
      .getAllByRole('radio', { name: /bank transfer/i })
      .find((radio) => radio.getAttribute('value') === 'bank_transfer');
    expect(paymentRadio).toBeDefined();
    fireEvent.click(paymentRadio as HTMLInputElement);
    fireEvent.click(
      screen
        .getAllByRole('button', { name: /place order/i })
        .find((button) => !button.hasAttribute('disabled')) as HTMLButtonElement
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/orders', expect.anything())
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/payments/initialize',
        expect.anything()
      )
    );
    fetchMock.mockRestore();
    cleanup();
  };

  await submitBankTransfer();
  // Rejected initialization: the transfer flow never opened, so the
  // failure surfaces as error UI only — no unmatched payment_failed.
  await waitFor(() => {
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Bank Transfer Failed' })
    );
  });
  expect(failedEvents).toHaveLength(0);
  expect(startedEvents).toHaveLength(0);

  dvaSucceeds = true;
  await submitBankTransfer();
  await waitFor(() => expect(startedEvents).toHaveLength(1));
  expect((startedEvents[0][1] as Record<string, unknown>).payment_method).toBe(
    'bank_transfer'
  );
  // The DVA start reconciles to its issued reference like the
  // redirect starts do.
  expect(startedEvents[0][1]).toEqual(
    expect.objectContaining({ reference: 'dva-ref-1' })
  );
});

it('persists the REDVAULT fence before returning to the review step', async () => {
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
      return Response.json({});
    });
  const { CHECKOUT_PENDING_ORDER_STORAGE_KEY } = await import(
    './checkout/pending-checkout-order'
  );

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

  // The review step renders only after order creation returns; the fence
  // must already be persisted so a reload cannot lose it.
  await screen.findByRole('button', { name: /review and continue to uba/i });
  const snapshot = window.sessionStorage.getItem(
    CHECKOUT_PENDING_ORDER_STORAGE_KEY
  );
  expect(snapshot).not.toBeNull();
  expect(JSON.parse(snapshot as string)).toMatchObject({
    orderId: 'order-redvault',
    paymentMethod: 'uba_redvault',
  });
  fetchMock.mockRestore();
});
