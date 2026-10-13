import {
  CHECKOUT_IDEMPOTENCY_STORAGE_KEY,
  expect,
  it,
  mockCaptureCheckoutFunnelEventOnce,
  mockCheckoutSubmissionState,
  submitPickupPayOnDeliveryOrder,
  useCart,
  useMerchantSafe,
  usePersistedForm,
  vi,
  waitFor,
} from './checkout-page-test-support';

it('sends a stable idempotency key when creating an order', async () => {
  const storageSpy = vi.spyOn(Storage.prototype, 'setItem');
  const scrollSpy = vi
    .spyOn(window, 'scrollTo')
    .mockImplementation(() => undefined);
  const randomUuidSpy = vi
    .spyOn(crypto, 'randomUUID')
    .mockReturnValue('11111111-1111-4111-8111-111111111111');
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
        variantId: 'variant-blue',
        variantAttributes: { color: ' Blue ', storage: '128GB' },
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
      feature_settings: {
        pay_on_delivery_enabled: true,
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
            amountDueToGateway: 5000,
            order: {
              id: 'order-123',
              order_number: 'ORD-123',
              tracking_token: 'track-123',
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

  await submitPickupPayOnDeliveryOrder();

  await waitFor(() => {
    expect(
      fetchMock.mock.calls.find(([url]) => String(url) === '/api/orders')?.[1]
    ).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': '11111111-1111-4111-8111-111111111111',
        }),
      })
    );
  });
  await waitFor(() => {
    expect(
      window.localStorage.getItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY)
    ).toBeNull();
  });

  const savedAttempt = storageSpy.mock.calls.find(
    ([key]) => key === 'storefront-checkout-pending-order'
  );
  expect(savedAttempt).toBeDefined();
  const snapshot = JSON.parse(String(savedAttempt?.[1]));
  expect(JSON.parse(snapshot.checkoutFingerprint).items[0]).toMatchObject({
    variantId: 'variant-blue',
    variantAttributes: { color: 'blue', storage: '128gb' },
  });
  expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
    'order_created',
    'order-123',
    expect.objectContaining({
      channel: 'web',
      order_id: 'order-123',
      order_number: 'ORD-123',
      source: 'web_checkout',
    })
  );
  storageSpy.mockRestore();
  fetchMock.mockRestore();
  randomUuidSpy.mockRestore();
  scrollSpy.mockRestore();
  window.localStorage.clear();
});

it('attributes order_created to the server-finalized method when coverage changes it', async () => {
  const scrollSpy = vi
    .spyOn(window, 'scrollTo')
    .mockImplementation(() => undefined);
  const randomUuidSpy = vi
    .spyOn(crypto, 'randomUUID')
    .mockReturnValue('11111111-1111-4111-8111-111111111111');
  window.localStorage.clear();
  mockCheckoutSubmissionState();

  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/orders') {
        return {
          ok: true,
          json: async () => ({
            amountDueToGateway: 0,
            order: {
              id: 'order-123',
              order_number: 'ORD-123',
              tracking_token: 'track-123',
              // Wallet fully covered an order placed under another
              // selection: creation must follow the finalized method.
              payment_method: 'wallet',
              payment_status: 'paid',
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

  await submitPickupPayOnDeliveryOrder();

  await waitFor(() => {
    expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
      'order_created',
      'order-123',
      expect.objectContaining({
        payment_method: 'wallet',
        payment_intent: 'pay_now',
        payment_status: 'paid',
      })
    );
  });
  fetchMock.mockRestore();
  randomUuidSpy.mockRestore();
  scrollSpy.mockRestore();
  window.localStorage.clear();
});
