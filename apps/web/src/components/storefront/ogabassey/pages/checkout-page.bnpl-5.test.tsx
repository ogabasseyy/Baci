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
  mockCaptureCheckoutFunnelEventOnce,
  mockCaptureClientEvent,
  openCredPalCheckout,
  render,
  screen,
  useCart,
  useMerchantSafe,
  usePersistedForm,
  useRouter,
  vi,
  waitFor,
  walletFundedTransferMock,
} from './checkout-page-test-support';

it('tracks payment_failed when CredPal errors after the widget loads', async () => {
  vi.stubEnv('NEXT_PUBLIC_CREDPAL_KEY', 'pk_test_credpal');
  const { fetchMock } = renderFreshBNPLCheckout({
    featureSettings: { credpal_enabled: true },
    orderId: 'order-credpal-matched-error',
  });

  try {
    await driveFreshBNPLPlaceOrder(/credpal/i);

    await waitFor(() => {
      expect(openCredPalCheckout).toHaveBeenCalled();
    });
    const callArgs = vi.mocked(openCredPalCheckout).mock.calls[0]?.[0];
    await act(async () => {
      callArgs?.onLoad?.();
    });
    await waitFor(() => {
      expect(paymentStartedCalls()).toHaveLength(1);
    });

    await act(async () => {
      callArgs?.onError?.({ success: false, message: 'declined' });
    });

    await waitFor(() => {
      expect(
        mockCaptureClientEvent.mock.calls.some(
          ([event]) => event === 'payment_failed'
        )
      ).toBe(true);
    });
  } finally {
    fetchMock.mockRestore();
    vi.unstubAllEnvs();
  }
});

it('closes a CredPal failure at the canonical order total, not the residual due', async () => {
  vi.stubEnv('NEXT_PUBLIC_CREDPAL_KEY', 'pk_test_credpal');
  const { fetchMock } = renderFreshBNPLCheckout({
    featureSettings: { credpal_enabled: true },
    orderId: 'order-credpal-canonical-total',
    // Canonical total above the 5750 residual gateway due.
    orderTotal: 6000,
  });

  try {
    await driveFreshBNPLPlaceOrder(/credpal/i);

    await waitFor(() => {
      expect(openCredPalCheckout).toHaveBeenCalled();
    });
    const callArgs = vi.mocked(openCredPalCheckout).mock.calls[0]?.[0];
    await act(async () => {
      callArgs?.onLoad?.();
    });
    await waitFor(() => {
      expect(paymentStartedCalls()).toHaveLength(1);
    });

    await act(async () => {
      callArgs?.onError?.({ success: false, message: 'declined' });
    });

    await waitFor(() => {
      expect(
        mockCaptureClientEvent.mock.calls.some(
          ([event]) => event === 'payment_failed'
        )
      ).toBe(true);
    });
    const failure = mockCaptureClientEvent.mock.calls.find(
      ([event]) => event === 'payment_failed'
    );
    expect(failure?.[1]).toEqual(
      expect.objectContaining({ reason: 'credpal_error', total: 6000 })
    );
  } finally {
    fetchMock.mockRestore();
    vi.unstubAllEnvs();
  }
});

it('records payment_completed before redirecting a paid wallet-funded transfer', async () => {
  const routerPush = vi.fn();
  vi.mocked(useRouter).mockReturnValue({
    push: routerPush,
    back: vi.fn(),
    replace: vi.fn(),
  } as unknown as ReturnType<typeof useRouter>);
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
    merchant: {
      id: 'merchant-1',
      slug: 'ogabassey',
      business_name: 'Test Store',
      vat_registration_status: 'registered',
      vat_rate: 7.5,
      country: 'NG',
      paystack_subaccount_code: 'ACCT_123',
      feature_settings: {
        paystack_enabled: true,
        wallet_paystack_dva_enabled: true,
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
      currentStep: 'delivery',
      completedSteps: { contact: true, delivery: false },
    },
    setValue: vi.fn(),
    setValues: vi.fn(),
    clear: vi.fn(),
  } as unknown as ReturnType<typeof usePersistedForm>);
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () =>
      ({
        ok: true,
        json: async () => ({ states: ['Lagos'], locations: [] }),
        text: async () => '',
      }) as Response
  );

  try {
    render(<CheckoutPage />);
    fireEvent.click(screen.getByRole('button', { name: /delivery method/i }));
    fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
    fireEvent.click(
      screen.getByRole('button', { name: /continue to payment/i })
    );
    const bankTransferRadio = (
      await screen.findAllByRole('radio', { name: /bank transfer/i })
    ).find((radio) => radio.getAttribute('value') === 'bank_transfer');
    expect(bankTransferRadio).toBeDefined();
    fireEvent.click(bankTransferRadio as HTMLInputElement);

    // The polling hook reports a server-confirmed completed intent.
    await act(async () => {
      walletFundedTransferMock.onOrderPaid?.({
        checkoutFingerprint: 'fingerprint-wf-1',
        currency: 'NGN',
        intentId: 'intent-wf-1',
        orderId: 'order-wf-1',
        orderNumber: 'ORD-WF-1',
        total: 5750,
        trackingToken: 'track-wf-1',
      });
    });

    expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
      'payment_completed',
      'order-wf-1',
      expect.objectContaining({
        order_number: 'ORD-WF-1',
        payment_method: 'bank_transfer',
        payment_status: 'paid',
        reference: 'intent-wf-1',
        total: 5750,
      })
    );
    expect(routerPush).toHaveBeenCalledWith(
      expect.stringContaining(
        '/order-success?orderId=order-wf-1&wallet=true&trackingToken=track-wf-1'
      )
    );
  } finally {
    fetchMock.mockRestore();
  }
});
