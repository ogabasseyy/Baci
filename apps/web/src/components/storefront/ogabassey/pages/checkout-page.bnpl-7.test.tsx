import {
  CheckoutPage,
  expect,
  fireEvent,
  it,
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
} from './checkout-page-test-support';

it('routes pending CredPal applications to success without a paid conversion', async () => {
  const completedEvents: unknown[][] = [];
  mockCaptureClientEvent.mockImplementation((...args: unknown[]) => {
    if (args[0] === 'payment_completed') completedEvents.push(args);
  });
  vi.stubEnv('NEXT_PUBLIC_CREDPAL_KEY', 'pk_test_credpal');
  const merchant = {
    id: 'merchant-1',
    slug: 'ogabassey',
    business_name: 'Test Store',
    country: 'NG',
    paystack_subaccount_configured: true,
    vat_registration_status: 'registered',
    vat_rate: 7.5,
    feature_settings: {
      credpal_enabled: true,
      paystack_enabled: true,
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
    merchant,
    basePath: '/ogabassey',
  } as unknown as ReturnType<typeof useMerchantSafe>);
  vi.mocked(usePersistedForm).mockReturnValue(paymentForm);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input) === '/api/orders') {
      return {
        ok: true,
        json: async () => ({
          amountDueToGateway: 5000,
          order: {
            id: 'order-credpal',
            order_number: 'ORD-CREDPAL',
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
  vi.mocked(openCredPalCheckout).mockImplementation(async ({ onSuccess }) => {
    await onSuccess?.({
      order_no: 'credpal-pending-1',
      status: 'pending',
    } as never);
  });

  render(<CheckoutPage />);
  fireEvent.click(screen.getByRole('button', { name: /delivery method/i }));
  fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
  fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
  fireEvent.click(screen.getByRole('button', { name: /pay in installments/i }));
  const paymentRadio = screen
    .getAllByRole('radio', { name: /credpal/i })
    .find((radio) => radio.getAttribute('value') === 'credpal');
  expect(paymentRadio).toBeDefined();
  fireEvent.click(paymentRadio as HTMLInputElement);
  fireEvent.click(
    screen
      .getAllByRole('button', { name: /place order/i })
      .find((button) => !button.hasAttribute('disabled')) as HTMLButtonElement
  );

  await waitFor(() => expect(openCredPalCheckout).toHaveBeenCalled());
  await waitFor(() =>
    expect(routerPush).toHaveBeenCalledWith(
      expect.stringContaining('/order-success?')
    )
  );
  expect(routerPush).toHaveBeenCalledWith(
    expect.stringContaining('type=credpal')
  );
  expect(routerPush).toHaveBeenCalledWith(
    expect.stringContaining('credpalStatus=pending')
  );
  expect(completedEvents).toHaveLength(0);
  vi.unstubAllEnvs();
});
