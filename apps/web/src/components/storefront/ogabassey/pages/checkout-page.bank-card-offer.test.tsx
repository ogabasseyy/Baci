import {
  CheckoutPage,
  continueToPaymentAfterPickupCheck,
  expect,
  fireEvent,
  it,
  mockCheckoutSubmissionState,
  render,
  screen,
  useAuthSafe,
  useMerchantSafe,
  usePersistedState,
  vi,
  waitFor,
} from './checkout-page-test-support';

const wema = {
  id: 'wema-test',
  verifiedIssuerName: 'Wema Bank',
  eligibleProductIds: ['item-1'],
  cardBrands: ['visa' as const],
  discountBasisPoints: 500,
  maximumDiscountKobo: 100_000,
  startsAt: '2020-01-01T00:00:00Z',
  endsAt: '2099-01-01T00:00:00Z',
};

function setupCheckout() {
  mockCheckoutSubmissionState();
  vi.mocked(useAuthSafe).mockReturnValue({
    user: { id: 'buyer-1', email: 'ada@example.com' },
  } as ReturnType<typeof useAuthSafe>);
  const context = vi.mocked(useMerchantSafe).getMockImplementation()?.();
  if (!context?.merchant) throw new Error('Missing merchant fixture');
  vi.mocked(useMerchantSafe).mockReturnValue({
    ...context,
    merchant: {
      ...context.merchant,
      paystack_subaccount_code: 'ACCT_test',
      feature_settings: {
        ...context.merchant.feature_settings,
        paystack_enabled: true,
      },
    },
  });
}

async function openPayment() {
  fireEvent.click(screen.getByRole('button', { name: /delivery method/i }));
  fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
  await continueToPaymentAfterPickupCheck();
}

it('shows the capped card savings and sends the accepted discounted total through checkout', async () => {
  setupCheckout();
  const persisted = await vi.importActual<
    typeof import('@/hooks/use-persisted-state')
  >('@/hooks/use-persisted-state');
  vi.mocked(usePersistedState).mockImplementation(persisted.usePersistedState);
  const createOrder = vi.fn();
  const initialize = vi.fn();
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input, init) => {
      if (String(input) === '/api/orders') {
        createOrder(JSON.parse(String(init?.body)));
        return Response.json({
          order: {
            id: 'order-1',
            order_number: 'BC-1',
            tracking_token: 'tracking',
            payment_method: 'bank_card_offer',
            total: 5125,
            currency: 'NGN',
          },
          amountDueToGateway: 5125,
        });
      }
      if (String(input).startsWith('/api/storefront/orders/order-1?')) {
        return Response.json({
          id: 'order-1',
          order_number: 'BC-1',
          payment_method: 'bank_card_offer',
          currency: 'NGN',
          total: 5125,
          shipping_status: 'pending',
          payment_status: 'unpaid',
        });
      }
      if (String(input) === '/api/payments/initialize') {
        initialize(JSON.parse(String(init?.body)));
        return Response.json(
          { code: 'BANK_CARD_OFFER_INITIALIZATION_PENDING' },
          { status: 503 }
        );
      }
      return Response.json({ states: ['Lagos'], locations: [] });
    });

  try {
    render(<CheckoutPage bankCardOffers={[wema]} />);
    await openPayment();
    const option = await screen.findByRole('button', {
      name: /wema bank card offer/i,
    });
    expect(option).toHaveTextContent(/save.*250/i);
    expect(option).toHaveTextContent('5,125');
    fireEvent.click(option);
    expect(option).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText(/5,125/).length).toBeGreaterThan(1);
    const button = screen
      .getAllByRole('button', { name: /place order/i })
      .find((candidate) => !candidate.hasAttribute('disabled'));
    expect(button).toBeDefined();
    fireEvent.click(button as HTMLButtonElement);

    await waitFor(() => {
      expect(createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_method: 'bank_card_offer',
          bank_card_offer_id: wema.id,
          expected_total: 5125,
        })
      );
      expect(initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          order_id: 'order-1',
          gateway: 'paystack',
          payment_method: 'bank_card_offer',
        })
      );
    });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button as HTMLButtonElement);
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(2));
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.map(([url]) => String(url))).not.toContain(
      '/api/orders/reuse'
    );
  } finally {
    fetch.mockRestore();
  }
});

it('keeps ordinary Paystack available when the shipped offer list is empty', async () => {
  setupCheckout();
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () =>
      Response.json({ states: ['Lagos'], locations: [] })
    );
  try {
    render(<CheckoutPage />);
    await openPayment();
    expect(
      await screen.findByRole('radio', { name: /paystack/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /wema bank|sterling bank/i })
    ).toBeNull();
  } finally {
    fetch.mockRestore();
  }
});
