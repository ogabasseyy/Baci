import {
  CHECKOUT_IDEMPOTENCY_STORAGE_KEY,
  CheckoutPage,
  expect,
  fireEvent,
  getCheckoutIdempotencyKey,
  it,
  mockCaptureCheckoutFunnelEventOnce,
  render,
  screen,
  useCart,
  useMerchantSafe,
  usePersistedForm,
  useRouter,
  vi,
  waitFor,
} from './checkout-page-test-support';

it('keeps another checkout recovery key when a DVA transfer confirms', async () => {
  const completedEvents: unknown[][] = [];
  mockCaptureCheckoutFunnelEventOnce.mockImplementation(
    (...args: unknown[]) => {
      if (args[0] === 'payment_completed') completedEvents.push(args);
    }
  );
  const routerPush = vi.fn();
  vi.mocked(useRouter).mockReturnValue({
    push: routerPush,
    back: vi.fn(),
    replace: vi.fn(),
  } as unknown as ReturnType<typeof useRouter>);
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
              id: 'order-dva',
              order_number: 'ORD-DVA',
              payment_status: 'paid',
              total: 5000,
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
            reference: 'dva-ref-1',
          }),
        } as Response;
      }
      if (url === '/api/orders') {
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

  render(<CheckoutPage />);
  fireEvent.click(screen.getByRole('button', { name: /delivery method/i }));
  fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
  fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
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
  const confirmButton = await screen.findByRole('button', {
    name: /confirm transfer sent/i,
  });

  // Another tab starts a newer checkout while the DVA modal is open.
  const otherTabKey = await getCheckoutIdempotencyKey('other-tab-fingerprint');
  fireEvent.click(confirmButton);
  await waitFor(() => {
    expect(completedEvents).toHaveLength(1);
  });

  // Completing the older transfer must not delete the newer tab's key.
  const stored = JSON.parse(
    window.localStorage.getItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY) || '{}'
  );
  expect(stored.key).toBe(otherTabKey);
  fetchMock.mockRestore();
});
