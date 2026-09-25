import {
  CheckoutPage,
  expect,
  fireEvent,
  it,
  mockCaptureCheckoutFunnelEventOnce,
  mockCheckoutSubmissionState,
  render,
  screen,
  useCart,
  useMerchantSafe,
  usePersistedForm,
  vi,
  waitFor,
} from './checkout-page-test-support';

it.each([
  'paystack',
  'korapay',
])('attributes order_created to the selected %s gateway despite card normalization', async (gateway) => {
  window.localStorage.clear();
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
      paystack_subaccount_code: 'ACCT_test',
      feature_settings: {
        paystack_enabled: true,
        korapay_enabled: true,
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

  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/payments/initialize') {
        return {
          ok: true,
          json: async () => ({
            success: true,
            authorization_url: 'https://checkout.example/test',
            reference: 'reference',
          }),
          text: async () => '',
        } as Response;
      }
      if (url === '/api/orders') {
        return {
          ok: true,
          json: async () => ({
            amountDueToGateway: 5750,
            order: {
              id: 'order-123',
              order_number: 'ORD-123',
              tracking_token: 'track-123',
              // The server persists ordinary card checkouts as
              // `card`: creation must still use the selected gateway
              // so it shares a funnel with start/completion.
              payment_method: 'card',
              payment_status: 'unpaid',
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
    const gatewayRadio = (
      await screen.findAllByRole('radio', { name: new RegExp(gateway, 'i') })
    ).find((radio) => radio.getAttribute('value') === gateway);
    expect(gatewayRadio).toBeDefined();
    fireEvent.click(gatewayRadio as HTMLInputElement);
    const placeOrderButton = screen
      .getAllByRole('button', { name: /place order/i })
      .find((button) => !button.hasAttribute('disabled'));
    fireEvent.click(placeOrderButton as HTMLButtonElement);

    await waitFor(() => {
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'order_created',
        'order-123',
        expect.objectContaining({
          payment_method: gateway,
          payment_intent: 'pay_now',
        })
      );
    });
  } finally {
    fetchMock.mockRestore();
    window.localStorage.clear();
  }
});

it('reserves the full order-summary scroll region so multi-item cart hydration does not reflow #main-content', async () => {
  mockCheckoutSubmissionState();

  render(<CheckoutPage />);

  await screen.findAllByText(/secure checkout/i);

  const orderSummary = screen
    .getByRole('heading', { name: /order summary/i })
    .closest('section,aside,div');

  expect(
    orderSummary?.querySelector('[class*="h-[200px]"]')
  ).toBeInTheDocument();
});
