import {
  CheckoutPage,
  expect,
  fireEvent,
  it,
  mockCaptureCheckoutFunnelEventOnce,
  render,
  screen,
  useCart,
  useMerchantSafe,
  usePersistedForm,
  vi,
  waitFor,
} from './checkout-page-test-support';

it('records payment_failed when the initial Juicyway check reports failed', async () => {
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
      feature_settings: { juicyway_enabled: true },
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
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/orders') {
        return {
          ok: true,
          json: async () => ({
            amountDueToGateway: 5750,
            order: {
              id: 'order-juicy-1',
              order_number: 'ORD-JUICY-1',
              tracking_token: 'track-juicy-1',
            },
            wallet: null,
          }),
          text: async () => '',
        } as Response;
      }
      if (url === '/api/payments/initialize') {
        return {
          ok: true,
          json: async () => ({
            success: true,
            reference: 'juicy-ref-1',
            session_id: 'sess-1',
            crypto_payment: {
              address: 'T7WHdR7vj4i3L4575w8V5hV8tKf9w2Q3xY',
              chain: 'TRX',
              currency: 'USDT',
              amount: 5750,
              crypto_amount: '1.5',
              confirmation_time: '10 minutes',
              payment_id: 'pay-1',
            },
          }),
          text: async () => '',
        } as Response;
      }
      if (url.startsWith('/api/payments/status')) {
        return {
          ok: true,
          json: async () => ({ is_failed: true }),
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
    const juicywayRadio = (
      await screen.findAllByRole('radio', { name: /juicyway/i })
    ).find((radio) => radio.getAttribute('value') === 'juicyway');
    fireEvent.click(juicywayRadio as HTMLInputElement);
    fireEvent.click(
      screen
        .getAllByRole('button', { name: /place order/i })
        .find((button) => !button.hasAttribute('disabled')) as HTMLButtonElement
    );
    fireEvent.click(
      await screen.findByRole('button', { name: /continue with USDT on TRX/i })
    );
    await waitFor(() => {
      expect(
        mockCaptureCheckoutFunnelEventOnce.mock.calls.filter(
          ([event]) => event === 'payment_started'
        )
      ).toHaveLength(1);
    });

    // Terminal initial check closes the recorded start with a failure.
    fireEvent.click(
      await screen.findByRole('button', { name: /i've sent the payment/i })
    );
    await waitFor(() => {
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_failed',
        'order-juicy-1:juicy-ref-1',
        expect.objectContaining({
          payment_method: 'juicyway',
          reason: 'juicyway_error',
          reference: 'juicy-ref-1',
        })
      );
    });
    expect(
      await screen.findByText(
        'Payment verification failed. Please contact support.'
      )
    ).toBeInTheDocument();
  } finally {
    fetchMock.mockRestore();
  }
});
