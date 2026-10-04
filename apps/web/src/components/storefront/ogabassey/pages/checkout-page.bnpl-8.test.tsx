import {
  act,
  CheckoutPage,
  cleanup,
  expect,
  fireEvent,
  it,
  mockCaptureCheckoutFunnelEventOnce,
  mockCaptureClientEvent,
  openCreditDirectCheckout,
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

it('tracks payment failures from Credit Direct and CredPal callbacks', async () => {
  const paymentErrorEvents: unknown[][] = [];
  mockCaptureClientEvent.mockImplementation((...args: unknown[]) => {
    if (args[0] === 'payment_failed') paymentErrorEvents.push(args);
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
      bank_transfer_enabled: true,
      credit_direct_enabled: true,
      credpal_enabled: true,
      paystack_enabled: true,
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
  const routerPush = vi.fn();
  vi.mocked(useRouter).mockReturnValue({
    push: routerPush,
    back: vi.fn(),
    replace: vi.fn(),
  } as unknown as ReturnType<typeof useRouter>);

  const submitAndCapture = async (
    tab: 'full' | 'installments',
    method: string
  ) => {
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
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, init) => {
        if (String(input) === '/api/payments/initialize') {
          const body = JSON.parse(String(init?.body));
          if (body.payment_type === 'dva') {
            return {
              ok: false,
              json: async () => ({ error: 'declined' }),
            } as Response;
          }
        }
        if (String(input) === '/api/orders') {
          return {
            ok: true,
            json: async () => ({
              amountDueToGateway: 5000,
              order: {
                id: `order-${method}`,
                order_number: `ORD-${method}`,
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

    render(<CheckoutPage />);
    fireEvent.click(screen.getByRole('button', { name: /delivery method/i }));
    fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
    fireEvent.click(
      screen.getByRole('button', { name: /continue to payment/i })
    );
    if (tab === 'installments')
      fireEvent.click(
        screen.getByRole('button', { name: /pay in installments/i })
      );
    const paymentLabel = method.replace('_', ' ');
    const paymentRadio = screen
      .getAllByRole('radio', { name: new RegExp(paymentLabel, 'i') })
      .find((radio) => radio.getAttribute('value') === method);
    expect(paymentRadio).toBeDefined();
    fireEvent.click(paymentRadio as HTMLInputElement);
    fireEvent.click(
      screen
        .getAllByRole('button', { name: /place order/i })
        .find((button) => !button.hasAttribute('disabled')) as HTMLButtonElement
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/orders', expect.anything())
    );

    if (method === 'credit_direct') {
      await waitFor(() => expect(openCreditDirectCheckout).toHaveBeenCalled());
      const options = vi
        .mocked(openCreditDirectCheckout)
        .mock.calls.at(-1)?.[0];
      expect(options).toBeDefined();
      // Matched error: the popup opened (payment_started), then failed.
      await act(async () => {
        await options?.onPopup?.({
          checkoutTransactionId: 'cd-popup-tracked-1',
          sessionId: 'signed-session-tracked-1',
        });
      });
      await act(async () => {
        options?.onError?.('declined');
      });
    } else if (method === 'credpal') {
      await waitFor(() => expect(openCredPalCheckout).toHaveBeenCalled());
      const options = vi.mocked(openCredPalCheckout).mock.calls.at(-1)?.[0];
      expect(options).toBeDefined();
      // Matched error: the widget loaded (payment_started), then failed.
      await act(async () => {
        options?.onLoad?.();
      });
      await act(async () => {
        options?.onError?.({ success: false, message: 'declined' });
      });
      mockCaptureCheckoutFunnelEventOnce.mockClear();
      await act(async () => {
        await options?.onSuccess?.({
          order_no: 'credpal-order-pending',
          item: 'Test Product',
          amount: 5000,
          status: 'pending',
          channel: 'web',
          customer: {
            full_name: 'Ada Buyer',
            email: 'ada@example.com',
            phone_no: '+2348123456789',
          },
          created_at: '2026-09-14T00:00:00.000Z',
        });
      });
      expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalledWith(
        'payment_completed',
        expect.anything(),
        expect.anything()
      );
      // Pending applications still reach the success experience.
      expect(clearCart).toHaveBeenCalled();
      expect(routerPush).toHaveBeenCalledWith(
        expect.stringContaining('/order-success?')
      );
      expect(routerPush).toHaveBeenCalledWith(
        expect.stringContaining('credpalStatus=pending')
      );
      await act(async () => {
        await options?.onSuccess?.({
          order_no: 'credpal-order-1',
          item: 'Test Product',
          amount: 5000,
          status: 'success',
          channel: 'web',
          customer: {
            full_name: 'Ada Buyer',
            email: 'ada@example.com',
            phone_no: '+2348123456789',
          },
          created_at: '2026-09-14T00:00:00.000Z',
        });
      });
    } else {
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/payments/initialize',
          expect.anything()
        )
      );
    }
    fetchMock.mockRestore();
    cleanup();
  };

  // Bank-transfer initialization failures no longer emit: no DVA was
  // ever ready, so there is no opened flow to match (covered by the
  // bank-transfer initialization test above).
  await submitAndCapture('installments', 'credit_direct');
  await submitAndCapture('installments', 'credpal');

  expect(paymentErrorEvents).toHaveLength(2);
  expect(
    paymentErrorEvents.map(
      ([, properties]) => (properties as Record<string, unknown>).payment_method
    )
  ).toEqual(['credit_direct', 'credpal']);
  expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
    'payment_completed',
    'order-credpal',
    expect.objectContaining({
      payment_method: 'credpal',
      reference: 'credpal-order-1',
    })
  );
  vi.unstubAllEnvs();
});
