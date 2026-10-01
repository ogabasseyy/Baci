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

it('labels DVA completion with the stamped order currency after a merchant currency change', async () => {
  // Order stamped USD while the merchant now prices in NGN: start and
  // completion must agree on the stamped currency.
  const completedEvents: unknown[][] = [];
  mockCaptureCheckoutFunnelEventOnce.mockImplementation(
    (...args: unknown[]) => {
      if (args[0] === 'payment_completed') completedEvents.push(args);
    }
  );
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
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/storefront/orders/track-order')) {
        return {
          ok: true,
          json: async () => ({
            order: {
              id: 'order-dva-fx',
              order_number: 'ORD-DVA-FX',
              payment_status: 'paid',
              total: 5750,
            },
          }),
        } as Response;
      }
      if (url === '/api/payments/initialize') {
        return {
          ok: true,
          json: async () => ({
            success: true,
            dva: {
              account_number: '1234567890',
              account_name: 'Test',
              bank_name: 'Test Bank',
            },
            reference: 'dva-ref-fx',
          }),
        } as Response;
      }
      if (url === '/api/orders') {
        return {
          ok: true,
          json: async () => ({
            amountDueToGateway: 5750,
            order: {
              id: 'order-dva-fx',
              order_number: 'ORD-DVA-FX',
              total: 5750,
              currency: 'USD',
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

  try {
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
    fireEvent.click(
      await screen.findByRole('button', { name: /confirm transfer sent/i })
    );

    await waitFor(() => {
      expect(completedEvents).toHaveLength(1);
    });
    expect(completedEvents[0]?.[2]).toEqual(
      expect.objectContaining({
        payment_method: 'bank_transfer',
        currency: 'USD',
        reference: 'dva-ref-fx',
      })
    );
  } finally {
    fetchMock.mockRestore();
  }
});
