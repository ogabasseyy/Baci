import {
  CHECKOUT_PENDING_ORDER_STORAGE_KEY,
  expect,
  it,
  mockCaptureClientEvent,
  submitPickupPayOnDeliveryOrder,
  toast,
  useCart,
  useMerchantSafe,
  usePersistedForm,
  vi,
  waitFor,
} from './checkout-page-test-support';

it('does not record payment_failed when session storage is blocked before any payment flow', async () => {
  const failedEvents: unknown[][] = [];
  const startedEvents: unknown[][] = [];
  mockCaptureClientEvent.mockImplementation((...args: unknown[]) => {
    if (args[0] === 'payment_failed') failedEvents.push(args);
    if (args[0] === 'payment_started') startedEvents.push(args);
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
  const originalSetItem = Storage.prototype.setItem;
  const setItemSpy = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ): void {
      if (key === CHECKOUT_PENDING_ORDER_STORAGE_KEY) {
        throw new Error('session storage blocked');
      }
      originalSetItem.call(this, key, value);
    });

  await submitPickupPayOnDeliveryOrder();

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith('/api/orders', expect.anything());
  });
  // The persist failure surfaces as a checkout error, not a payment one.
  await waitFor(() => {
    expect(vi.mocked(toast)).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Checkout Failed' })
    );
  });
  expect(startedEvents).toHaveLength(0);
  expect(failedEvents).toHaveLength(0);
  setItemSpy.mockRestore();
  fetchMock.mockRestore();
});
