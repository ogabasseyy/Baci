import {
  CheckoutPage,
  expect,
  fireEvent,
  it,
  mockCaptureCheckoutFunnelEventOnce,
  openCredPalCheckout,
  render,
  screen,
  useCart,
  useMerchantSafe,
  usePersistedForm,
  vi,
  waitFor,
} from './checkout-page-test-support';

it('records the full order total for CredPal completion after wallet credits', async () => {
  vi.stubEnv('NEXT_PUBLIC_CREDPAL_KEY', 'pk_test_credpal');
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
      feature_settings: { credpal_enabled: true },
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

  let capturedOnSuccess:
    | ((data: {
        status: 'success' | 'pending';
        order_no: string;
      }) => Promise<void>)
    | undefined;
  vi.mocked(openCredPalCheckout).mockImplementation(async (config) => {
    capturedOnSuccess = config.onSuccess as typeof capturedOnSuccess;
  });
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/orders') {
        return {
          ok: true,
          json: async () => ({
            // Wallet credits cover all but 750: the CredPal widget
            // opens on the residual while revenue stays the full total.
            amountDueToGateway: 750,
            order: {
              id: 'order-cred-1',
              order_number: 'ORD-CRED-1',
              tracking_token: 'track-cred-1',
              total: 5750,
            },
            wallet: null,
          }),
          text: async () => '',
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ states: ['Lagos'], locations: [] }),
        text: async () => '',
      } as Response;
    });

  try {
    render(<CheckoutPage />);
    fireEvent.click(screen.getByRole('button', { name: /delivery method/i }));
    fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
    fireEvent.click(
      screen.getByRole('button', { name: /continue to payment/i })
    );
    // CredPal lives under the installments tab.
    fireEvent.click(
      await screen.findByRole('button', { name: /pay in installments/i })
    );
    const credpalRadio = (
      await screen.findAllByRole('radio', { name: /credpal/i })
    ).find((radio) => radio.getAttribute('value') === 'credpal');
    expect(credpalRadio).toBeDefined();
    fireEvent.click(credpalRadio as HTMLInputElement);
    const placeOrderButton = screen
      .getAllByRole('button', { name: /place order/i })
      .find((button) => !button.hasAttribute('disabled'));
    fireEvent.click(placeOrderButton as HTMLButtonElement);

    await waitFor(() => {
      expect(openCredPalCheckout).toHaveBeenCalled();
    });
    await capturedOnSuccess?.({
      status: 'success',
      order_no: 'CP-123',
    });

    // Server-confirmed completion records the FULL order total, not
    // the 750 residual the widget opened with.
    await waitFor(() => {
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_completed',
        'order-cred-1',
        expect.objectContaining({
          payment_method: 'credpal',
          payment_status: 'paid',
          reference: 'CP-123',
          total: 5750,
        })
      );
    });
  } finally {
    fetchMock.mockRestore();
    window.localStorage.clear();
    vi.unstubAllEnvs();
  }
});
