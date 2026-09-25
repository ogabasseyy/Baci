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

it('defers invoice_generated to the success page for a zero-due invoice order', async () => {
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
      if (url === '/api/orders') {
        return {
          ok: true,
          json: async () => ({
            // A 100% discount zeroes the gateway amount while the order
            // stays unpaid — yet the server still generates and emails a
            // proforma for invoice-method orders.
            amountDueToGateway: 0,
            order: {
              id: 'order-123',
              order_number: 'ORD-123',
              tracking_token: 'track-123',
              payment_method: 'invoice',
              payment_status: 'unpaid',
              total: 0,
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
    fireEvent.click(
      screen.getByRole('button', { name: /get a proforma invoice/i })
    );
    const invoiceRadio = (
      await screen.findAllByRole('radio', { name: /get a proforma invoice/i })
    ).find((radio) => radio.getAttribute('value') === 'invoice');
    expect(invoiceRadio).toBeDefined();
    fireEvent.click(invoiceRadio as HTMLInputElement);
    // The invoice submit button shares its label with the invoice tab;
    // the tab carries aria-pressed, the submit button does not.
    const placeOrderButton = screen
      .getAllByRole('button', { name: 'Get a Proforma Invoice' })
      .find(
        (button) =>
          !button.hasAttribute('aria-pressed') &&
          !button.hasAttribute('disabled')
      );
    expect(placeOrderButton).toBeDefined();
    fireEvent.click(placeOrderButton as HTMLButtonElement);

    // Creation still records order_created, but invoice_generated waits
    // for the success page's terminal-delivery confirmation (the server
    // builds the artifacts asynchronously in after()).
    await waitFor(() => {
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'order_created',
        'order-123',
        expect.anything()
      );
    });
    expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalledWith(
      'invoice_generated',
      expect.anything(),
      expect.anything()
    );
    expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalledWith(
      'payment_completed',
      expect.anything(),
      expect.anything()
    );
  } finally {
    fetchMock.mockRestore();
    window.localStorage.clear();
  }
});
