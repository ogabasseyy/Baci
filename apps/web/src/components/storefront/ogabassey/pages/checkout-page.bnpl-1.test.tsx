import {
  driveFreshBNPLPlaceOrder,
  paymentStartedCalls,
  renderFreshBNPLCheckout,
} from './checkout-page-bnpl.test-support';
import {
  act,
  CheckoutPage,
  expect,
  fireEvent,
  it,
  mockCaptureClientEvent,
  openCredPalCheckout,
  render,
  screen,
  toast,
  useCart,
  useMerchantSafe,
  usePersistedForm,
  vi,
  waitFor,
} from './checkout-page-test-support';

it('shows Klump in installment checkout when the merchant enables it', async () => {
  vi.mocked(useCart).mockReturnValue({
    cart: [
      {
        id: 'item-1',
        name: 'Test Product',
        price: 50000,
        quantity: 1,
        image: '',
        slug: 'test-product',
      },
    ],
    cartTotal: 50000,
    clearCart: vi.fn(),
    isHydrated: true,
  } as unknown as ReturnType<typeof useCart>);
  vi.mocked(useMerchantSafe).mockReturnValue({
    merchant: {
      id: 'merchant-1',
      slug: 'ogabassey',
      business_name: 'Test Store',
      vat_registration_status: 'registered',
      vat_rate: 7.5,
      country: 'NG',
      feature_settings: {
        klump_enabled: true,
      },
    },
    basePath: '/ogabassey',
  } as unknown as ReturnType<typeof useMerchantSafe>);
  vi.mocked(usePersistedForm).mockReturnValue({
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
  } as unknown as ReturnType<typeof usePersistedForm>);
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({}),
  } as Response);

  render(<CheckoutPage />);

  fireEvent.click(screen.getByRole('button', { name: /pay in installments/i }));

  expect(await screen.findByText('Klump')).toBeInTheDocument();
  fetchMock.mockRestore();
});

it('hides Klump in installment checkout when the merchant disables it', async () => {
  vi.mocked(useCart).mockReturnValue({
    cart: [
      {
        id: 'item-1',
        name: 'Test Product',
        price: 50000,
        quantity: 1,
        image: '',
        slug: 'test-product',
      },
    ],
    cartTotal: 50000,
    clearCart: vi.fn(),
    isHydrated: true,
  } as unknown as ReturnType<typeof useCart>);
  vi.mocked(useMerchantSafe).mockReturnValue({
    merchant: {
      id: 'merchant-1',
      slug: 'ogabassey',
      business_name: 'Test Store',
      vat_registration_status: 'registered',
      vat_rate: 7.5,
      country: 'NG',
      feature_settings: {
        klump_enabled: false,
      },
    },
    basePath: '/ogabassey',
  } as unknown as ReturnType<typeof useMerchantSafe>);
  vi.mocked(usePersistedForm).mockReturnValue({
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
  } as unknown as ReturnType<typeof usePersistedForm>);
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({}),
  } as Response);

  render(<CheckoutPage />);

  expect(
    screen.queryByRole('button', { name: /pay in installments/i })
  ).not.toBeInTheDocument();

  expect(screen.queryByText('Klump')).not.toBeInTheDocument();
  fetchMock.mockRestore();
});

it('emits fresh CredPal payment_started only after the widget loads', async () => {
  vi.stubEnv('NEXT_PUBLIC_CREDPAL_KEY', 'pk_test_credpal');
  const { fetchMock } = renderFreshBNPLCheckout({
    featureSettings: { credpal_enabled: true },
    orderId: 'order-credpal-fresh',
  });

  try {
    await driveFreshBNPLPlaceOrder(/credpal/i);

    await waitFor(() => {
      expect(openCredPalCheckout).toHaveBeenCalled();
    });
    // The widget has not confirmed loading: no start yet.
    expect(paymentStartedCalls()).toHaveLength(0);

    const callArgs = vi.mocked(openCredPalCheckout).mock.calls[0]?.[0];
    await act(async () => {
      callArgs?.onLoad?.();
    });

    await waitFor(() => {
      expect(paymentStartedCalls()).toHaveLength(1);
    });
    expect(paymentStartedCalls()[0]?.[1]).toEqual(
      expect.objectContaining({ payment_method: 'credpal' })
    );
  } finally {
    fetchMock.mockRestore();
    vi.unstubAllEnvs();
  }
});

it('skips payment_failed when CredPal errors before the widget loads', async () => {
  vi.stubEnv('NEXT_PUBLIC_CREDPAL_KEY', 'pk_test_credpal');
  const { fetchMock } = renderFreshBNPLCheckout({
    featureSettings: { credpal_enabled: true },
    orderId: 'order-credpal-preload-error',
  });

  try {
    await driveFreshBNPLPlaceOrder(/credpal/i);

    await waitFor(() => {
      expect(openCredPalCheckout).toHaveBeenCalled();
    });
    const callArgs = vi.mocked(openCredPalCheckout).mock.calls[0]?.[0];
    await act(async () => {
      callArgs?.onError?.({ success: false, message: 'widget setup failed' });
    });

    // Unmatched error (widget never loaded): a failure toast for retry,
    // but no payment_failed attribution — no payment attempt started.
    await waitFor(() => {
      expect(toast).toHaveBeenCalled();
    });
    expect(paymentStartedCalls()).toHaveLength(0);
    expect(
      mockCaptureClientEvent.mock.calls.some(
        ([event]) => event === 'payment_failed'
      )
    ).toBe(false);
  } finally {
    fetchMock.mockRestore();
    vi.unstubAllEnvs();
  }
});
