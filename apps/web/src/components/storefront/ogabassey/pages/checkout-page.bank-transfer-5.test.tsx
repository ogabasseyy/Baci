import {
  act,
  CheckoutPage,
  checkoutIdempotency,
  expect,
  fireEvent,
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

it('abandons DVA side effects when the modal closes during cleanup', async () => {
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
        // The transfer has already landed server-side.
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
  const clearCart = vi.fn();
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
    clearCart,
    isHydrated: true,
  } as unknown as ReturnType<typeof useCart>);
  vi.mocked(useMerchantSafe).mockReturnValue({
    merchant,
    basePath: '/ogabassey',
  } as unknown as ReturnType<typeof useMerchantSafe>);
  vi.mocked(usePersistedForm).mockReturnValue(paymentForm);
  // Hold the post-confirmation cleanup open so the modal can close
  // during the gap.
  let resolveCleanup!: () => void;
  const cleanupSpy = vi
    .spyOn(checkoutIdempotency, 'clearCheckoutIdempotencyKey')
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveCleanup = resolve;
        })
    );

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

  fireEvent.click(confirmButton);
  // The conversion records (the money landed), then the continuation
  // parks on the held cleanup.
  await waitFor(() => {
    expect(completedEvents).toHaveLength(1);
  });
  expect(cleanupSpy).toHaveBeenCalledTimes(1);

  // Close during the cleanup gap: the retired attempt must gate the
  // routing and cart side effects even though the conversion stands.
  fireEvent.click(
    screen.getByRole('button', { name: /close and check later/i })
  );
  expect(
    screen.queryByRole('button', { name: /confirm transfer sent/i })
  ).toBeNull();
  act(() => {
    resolveCleanup();
  });
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(completedEvents).toHaveLength(1);
  expect(routerPush).not.toHaveBeenCalled();
  expect(clearCart).not.toHaveBeenCalled();
  fetchMock.mockRestore();
});
