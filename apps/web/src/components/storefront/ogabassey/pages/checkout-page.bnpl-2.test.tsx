import {
  driveFreshBNPLPlaceOrder,
  paymentStartedCalls,
  renderFreshBNPLCheckout,
} from './checkout-page-bnpl.test-support';
import {
  act,
  CheckoutPage,
  expect,
  fireEvent,
  it,
  mockCaptureClientEvent,
  openCreditDirectCheckout,
  render,
  screen,
  toast,
  useAuthSafe,
  useCart,
  useMerchantSafe,
  usePersistedForm,
  vi,
  waitFor,
} from './checkout-page-test-support';

it('hides Klump when wallet credit is auto-applied', async () => {
  vi.mocked(useAuthSafe).mockReturnValue({
    user: {
      id: 'customer-1',
      email: 'ada@example.com',
      user_metadata: {},
    },
  } as unknown as ReturnType<typeof useAuthSafe>);
  vi.mocked(useCart).mockReturnValue({
    cart: [
      {
        id: 'item-1',
        name: 'Test Product',
        price: 50000,
        quantity: 1,
        image: '',
        slug: 'test-product',
      },
    ],
    cartTotal: 50000,
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
        klump_enabled: true,
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
      currentStep: 'payment',
      completedSteps: { contact: true, delivery: true },
    },
    setValue: vi.fn(),
    setValues: vi.fn(),
    clear: vi.fn(),
  } as unknown as ReturnType<typeof usePersistedForm>);
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/storefront/customer/wallet')) {
        return {
          ok: true,
          json: async () => ({ balance: 10000 }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
        text: async () => '',
      } as Response;
    });

  try {
    render(<CheckoutPage />);

    fireEvent.click(
      screen.getByRole('button', { name: /pay in installments/i })
    );

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).startsWith('/api/storefront/customer/wallet')
        )
      ).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryByText('Klump')).not.toBeInTheDocument();
    });
  } finally {
    fetchMock.mockRestore();
  }
});

it('emits fresh Credit Direct payment_started only after the popup opens', async () => {
  const { fetchMock } = renderFreshBNPLCheckout({
    featureSettings: { credit_direct_enabled: true },
    orderId: 'order-cd-fresh',
  });

  try {
    await driveFreshBNPLPlaceOrder(/credit direct/i);

    await waitFor(() => {
      expect(openCreditDirectCheckout).toHaveBeenCalled();
    });
    // The opener resolved without a popup: no start yet.
    expect(paymentStartedCalls()).toHaveLength(0);

    const callArgs = vi.mocked(openCreditDirectCheckout).mock.calls[0]?.[0];
    await act(async () => {
      await callArgs?.onPopup?.({
        checkoutTransactionId: 'cd-popup-fresh-1',
        sessionId: 'signed-session-fresh-1',
      });
    });

    await waitFor(() => {
      expect(paymentStartedCalls()).toHaveLength(1);
    });
    expect(paymentStartedCalls()[0]?.[1]).toEqual(
      expect.objectContaining({ payment_method: 'credit_direct' })
    );
  } finally {
    fetchMock.mockRestore();
  }
});

it('skips payment_started when fresh Credit Direct initialization fails', async () => {
  const { fetchMock } = renderFreshBNPLCheckout({
    featureSettings: { credit_direct_enabled: true },
    orderId: 'order-cd-fresh-fail',
  });
  vi.mocked(openCreditDirectCheckout).mockImplementationOnce(
    async ({ onError }) => {
      onError?.('Failed to initialize Credit Direct');
    }
  );

  try {
    await driveFreshBNPLPlaceOrder(/credit direct/i);

    await waitFor(() => {
      expect(openCreditDirectCheckout).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Credit Direct Failed' })
      );
    });
    expect(paymentStartedCalls()).toHaveLength(0);
    // Unmatched error (no popup ever opened): a failure toast for retry,
    // but no payment_failed attribution — no payment attempt started.
    expect(
      mockCaptureClientEvent.mock.calls.some(
        ([event]) => event === 'payment_failed'
      )
    ).toBe(false);
  } finally {
    fetchMock.mockRestore();
  }
});
