import { jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import {
  getPaymentInitializeCalls,
  mockAlert,
  mockCreateOrder,
  mockCreateOrderWalletFundingIntent,
  mockCreateWalletFundingAccount,
  mockListSavingsGoals,
  mockPaymentSettings,
  mockRouterPush,
  mockRouterReplace,
  mockTrackCheckoutStarted,
  mockTrackError,
  mockUseAuthStatus,
  mockUseMerchantPaymentSettings,
  renderCheckoutScreen,
  setupCheckoutTest,
  teardownCheckoutTest,
} from './checkout.test-utils';
import { fillCheckoutContact } from './checkout-contact.test-utils';

function fillLagosDeliveryAddress() {
  fireEvent.changeText(
    screen.getByPlaceholderText('Start typing your address…'),
    'No. 5 Example Plaza'
  );
  fireEvent.press(screen.getByRole('button', { name: 'Mock select State' }));
  fireEvent.press(screen.getByRole('button', { name: 'Mock select City' }));
}

function selectPickupAndContinueToPayment() {
  fireEvent.press(
    screen.getByRole('button', { name: 'Select pickup station' })
  );
  fireEvent.press(screen.getByRole('button', { name: 'Continue to payment' }));
}

function fillAddressAndContinueToPayment() {
  fillCheckoutContact();
  fillLagosDeliveryAddress();
  selectPickupAndContinueToPayment();
}

function selectPaystackPayment() {
  fireEvent.press(screen.getByRole('button', { name: 'Mock select Paystack' }));
}

function enableAuthenticatedWalletFundedCheckout() {
  mockUseAuthStatus.mockReturnValue({
    customer: {
      email: 'ada@example.com',
      first_name: 'Ada',
      id: 'customer-1',
      last_name: 'Lovelace',
      phone: '08031234567',
    },
    isAuthenticated: true,
    isGuest: false,
    isInitialized: true,
    isLoading: false,
    user: { id: 'user-1' },
  });
  Object.assign(mockPaymentSettings, {
    wallet_order_auto_debit_enabled: true,
    wallet_paystack_dva_enabled: true,
  });
}

async function placeWalletFundedBankTransferOrder() {
  renderCheckoutScreen();
  fillAddressAndContinueToPayment();

  await waitFor(() => {
    expect(screen.getByText('Bank transfer to wallet')).toBeOnTheScreen();
  });

  fireEvent.press(
    screen.getByRole('button', { name: 'Mock select Bank transfer to wallet' })
  );
  fireEvent.press(screen.getByRole('button', { name: 'Continue to review' }));

  await waitFor(() => {
    expect(screen.getByText('Review Order')).toBeOnTheScreen();
  });

  fireEvent.press(screen.getByRole('button', { name: /Place order for/i }));
}

function createConsentError(code: string, message: string) {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

describe('CheckoutScreen', () => {
  beforeEach(() => {
    setupCheckoutTest();
  });

  afterEach(() => {
    teardownCheckoutTest();
  });

  it('renders checkout with address step visible by default', async () => {
    renderCheckoutScreen();

    expect(screen.getByText('Checkout')).toBeOnTheScreen();
    expect(screen.getByText('Delivery Address')).toBeOnTheScreen();
    expect(screen.getByLabelText('checkout-step')).toHaveTextContent(
      'step:address'
    );

    await waitFor(() => {
      expect(mockTrackCheckoutStarted).toHaveBeenCalledTimes(1);
    });
  }, 30_000);

  it('continues from address to payment when required fields are valid', async () => {
    renderCheckoutScreen();

    fillAddressAndContinueToPayment();

    await waitFor(() => {
      expect(screen.getByText('Payment Method')).toBeOnTheScreen();
      expect(screen.getByLabelText('checkout-step')).toHaveTextContent(
        'step:payment'
      );
    });
  });

  it('renders the extracted review summary after progressing through checkout', async () => {
    renderCheckoutScreen();

    fillAddressAndContinueToPayment();

    await waitFor(() => {
      expect(screen.getByLabelText('checkout-step')).toHaveTextContent(
        'step:payment'
      );
    });

    selectPaystackPayment();
    fireEvent.press(screen.getByLabelText('Continue to review'));

    await waitFor(() => {
      expect(screen.getByLabelText('checkout-step')).toHaveTextContent(
        'step:review'
      );
      expect(screen.getByText('Review Order')).toBeOnTheScreen();
      expect(screen.getByText('Card Payment (Paystack)')).toBeOnTheScreen();
    });
  });

  it('delegates BNPL retry identity to the order service when switching providers', async () => {
    mockUseMerchantPaymentSettings.mockReturnValue({
      data: {
        ...mockPaymentSettings,
        credpal_enabled: false,
        credit_direct_enabled: true,
        juicyway_enabled: false,
        klump_enabled: true,
        klump_max_amount: 5_000_000,
        klump_min_amount: 1_000,
        korapay_enabled: false,
        pay_on_delivery_enabled: false,
        paystack_enabled: true,
        vat_rate: 0,
        vat_registration_status: 'unregistered',
      },
    });
    renderCheckoutScreen();

    fillAddressAndContinueToPayment();
    await waitFor(() => {
      expect(screen.getByText('Payment Method')).toBeOnTheScreen();
    });

    fireEvent.press(
      screen.getByRole('button', { name: 'Mock select Credit Direct' })
    );
    await waitFor(() => {
      expect(
        screen.getByText('Selected payment: credit_direct')
      ).toBeOnTheScreen();
    });
    fireEvent.press(screen.getByRole('button', { name: 'Continue to review' }));
    await waitFor(() => {
      expect(screen.getByText('Review Order')).toBeOnTheScreen();
    });
    fireEvent.press(screen.getByRole('button', { name: /Place order for/i }));

    await waitFor(() => {
      expect(mockCreateOrder).toHaveBeenCalledTimes(1);
    });
    expect(mockCreateOrder.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        payment_method: 'credit_direct',
      })
    );
    expect(mockCreateOrder.mock.calls[0]?.[0]).not.toHaveProperty(
      'idempotency_key'
    );

    fireEvent.press(
      screen.getByRole('button', { name: 'Edit payment method' })
    );
    fireEvent.press(screen.getByRole('button', { name: 'Mock select Klump' }));
    await waitFor(() => {
      expect(screen.getByText('Selected payment: klump')).toBeOnTheScreen();
    });
    fireEvent.press(screen.getByRole('button', { name: 'Continue to review' }));
    fireEvent.press(screen.getByRole('button', { name: /Place order for/i }));

    await waitFor(() => {
      expect(mockCreateOrder).toHaveBeenCalledTimes(2);
    });
    expect(mockCreateOrder.mock.calls[1]?.[0]).not.toHaveProperty(
      'idempotency_key'
    );
  });

  it.each([
    'CHECKOUT_ORDER_NOT_REUSABLE',
    'CHECKOUT_IDEMPOTENCY_CONFLICT',
  ])('does not override the order service retry identity after %s', async (errorCode) => {
    const { OrderError } = jest.requireMock(
      '@/services/orders'
    ) as typeof import('@/services/orders');
    const staleOrderError = new OrderError(
      'This checkout order can no longer be reused.',
      errorCode
    );

    mockUseMerchantPaymentSettings.mockReturnValue({
      data: {
        ...mockPaymentSettings,
        credpal_enabled: false,
        credit_direct_enabled: true,
        juicyway_enabled: false,
        klump_enabled: true,
        klump_max_amount: 5_000_000,
        klump_min_amount: 1_000,
        korapay_enabled: false,
        pay_on_delivery_enabled: false,
        paystack_enabled: true,
        vat_rate: 0,
        vat_registration_status: 'unregistered',
      },
    });
    mockCreateOrder.mockRejectedValueOnce(staleOrderError);
    renderCheckoutScreen();

    fillAddressAndContinueToPayment();
    await waitFor(() => {
      expect(screen.getByText('Payment Method')).toBeOnTheScreen();
    });

    fireEvent.press(
      screen.getByRole('button', { name: 'Mock select Credit Direct' })
    );
    await waitFor(() => {
      expect(
        screen.getByText('Selected payment: credit_direct')
      ).toBeOnTheScreen();
    });
    fireEvent.press(screen.getByRole('button', { name: 'Continue to review' }));
    await waitFor(() => {
      expect(screen.getByText('Review Order')).toBeOnTheScreen();
    });
    fireEvent.press(screen.getByRole('button', { name: /Place order for/i }));

    await waitFor(() => {
      expect(mockCreateOrder).toHaveBeenCalledTimes(1);
    });
    expect(mockCreateOrder.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        payment_method: 'credit_direct',
      })
    );
    expect(mockCreateOrder.mock.calls[0]?.[0]).not.toHaveProperty(
      'idempotency_key'
    );

    fireEvent.press(screen.getByRole('button', { name: /Place order for/i }));

    await waitFor(() => {
      expect(mockCreateOrder).toHaveBeenCalledTimes(2);
    });
    expect(mockCreateOrder.mock.calls[1]?.[0]).toEqual(
      mockCreateOrder.mock.calls[0]?.[0]
    );
  });

  it('forwards checkout savings credit fields when a matching device savings goal is selected', async () => {
    // Arrange
    mockUseAuthStatus.mockReturnValue({
      customer: {
        email: 'ada@example.com',
        first_name: 'Ada',
        id: 'customer-1',
        last_name: 'Lovelace',
        phone: '08031234567',
      },
      isAuthenticated: true,
      isGuest: false,
      isInitialized: true,
      isLoading: false,
      user: { id: 'user-1' },
    });
    mockListSavingsGoals.mockResolvedValue({
      goals: [
        {
          breakFeePercent: 3,
          contributionAmount: 20000,
          contributionFrequency: 'daily',
          currentAmount: 150000,
          id: '123e4567-e89b-12d3-a456-426614174555',
          maturityDate: '2026-06-20',
          productId: 'product-1',
          sourceMode: 'manual',
          startDate: '2026-05-21',
          status: 'active',
          targetAmount: 470000,
          title: 'iPhone savings',
          variantId: null,
        },
      ],
      summary: {
        activeGoalCount: 1,
        savingsBalance: 150000,
      },
    });

    renderCheckoutScreen();

    // Act
    fillAddressAndContinueToPayment();

    await waitFor(() => {
      expect(screen.getByText('Payment Method')).toBeOnTheScreen();
    });

    await waitFor(() => {
      expect(mockListSavingsGoals).toHaveBeenCalledTimes(1);
      expect(
        screen.getByRole('button', { name: 'Mock use checkout savings' })
      ).toBeOnTheScreen();
    });
    await waitFor(() => {
      expect(screen.getByText('Payment Method')).toBeOnTheScreen();
    });

    fireEvent.press(
      screen.getByRole('button', { name: 'Mock use checkout savings' })
    );
    selectPaystackPayment();
    fireEvent.press(screen.getByRole('button', { name: 'Continue to review' }));

    await waitFor(() => {
      expect(screen.getByText('Review Order')).toBeOnTheScreen();
    });

    fireEvent.press(screen.getByRole('button', { name: /Place order for/i }));

    // Assert
    await waitFor(() => {
      expect(mockCreateOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          savings_amount: 150000,
          savings_goal_id: '123e4567-e89b-12d3-a456-426614174555',
          use_savings_credit: true,
        })
      );
    });
  });

  it('omits checkout savings credit fields when the selected goal is deselected', async () => {
    // Arrange
    mockUseAuthStatus.mockReturnValue({
      customer: {
        email: 'ada@example.com',
        first_name: 'Ada',
        id: 'customer-1',
        last_name: 'Lovelace',
        phone: '08031234567',
      },
      isAuthenticated: true,
      isGuest: false,
      isInitialized: true,
      isLoading: false,
      user: { id: 'user-1' },
    });
    mockListSavingsGoals.mockResolvedValue({
      goals: [
        {
          breakFeePercent: 3,
          contributionAmount: 20000,
          contributionFrequency: 'daily',
          currentAmount: 150000,
          id: '123e4567-e89b-12d3-a456-426614174555',
          maturityDate: '2026-06-20',
          productId: 'product-1',
          sourceMode: 'manual',
          startDate: '2026-05-21',
          status: 'active',
          targetAmount: 470000,
          title: 'iPhone savings',
          variantId: null,
        },
      ],
      summary: {
        activeGoalCount: 1,
        savingsBalance: 150000,
      },
    });

    renderCheckoutScreen();

    // Act
    fillAddressAndContinueToPayment();

    await waitFor(() => {
      expect(mockListSavingsGoals).toHaveBeenCalledTimes(1);
    });

    fireEvent.press(
      await screen.findByRole('button', {
        name: 'Mock use checkout savings',
      })
    );
    fireEvent.press(
      await screen.findByRole('button', {
        name: 'Mock remove checkout savings',
      })
    );
    selectPaystackPayment();
    fireEvent.press(screen.getByRole('button', { name: 'Continue to review' }));

    await waitFor(() => {
      expect(screen.getByText('Review Order')).toBeOnTheScreen();
    });

    fireEvent.press(screen.getByRole('button', { name: /Place order for/i }));

    // Assert
    await waitFor(() => {
      expect(mockCreateOrder).toHaveBeenCalledTimes(1);
    });
    const orderPayload = mockCreateOrder.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(orderPayload).not.toHaveProperty('savings_amount');
    expect(orderPayload).not.toHaveProperty('savings_goal_id');
    expect(orderPayload).not.toHaveProperty('use_savings_credit');
  });

  it('skips payment initialization when savings fully pays the order', async () => {
    // Arrange
    mockUseAuthStatus.mockReturnValue({
      customer: {
        email: 'ada@example.com',
        first_name: 'Ada',
        id: 'customer-1',
        last_name: 'Lovelace',
        phone: '08031234567',
      },
      isAuthenticated: true,
      isGuest: false,
      isInitialized: true,
      isLoading: false,
      user: { id: 'user-1' },
    });
    mockListSavingsGoals.mockResolvedValue({
      goals: [
        {
          breakFeePercent: 3,
          contributionAmount: 20000,
          contributionFrequency: 'daily',
          currentAmount: 470000,
          id: '123e4567-e89b-12d3-a456-426614174555',
          maturityDate: '2026-06-20',
          productId: 'product-1',
          sourceMode: 'manual',
          startDate: '2026-05-21',
          status: 'active',
          targetAmount: 470000,
          title: 'iPhone savings',
          variantId: null,
        },
      ],
      summary: {
        activeGoalCount: 1,
        savingsBalance: 470000,
      },
    });
    mockCreateOrder.mockResolvedValueOnce({
      amountDueToGateway: 0,
      order: {
        id: 'order-full-savings',
        order_number: 'ORD-SAVE',
        payment_status: 'paid',
        shipping_status: 'pending',
        total: 470000,
        tracking_token: 'track-1',
      },
      savings: {
        amountUsed: 470000,
        goalId: '123e4567-e89b-12d3-a456-426614174555',
        redemptionId: 'redeem-1',
      },
      wallet: null,
    });

    renderCheckoutScreen();

    // Act
    fillAddressAndContinueToPayment();

    await waitFor(() => {
      expect(screen.getByText('Payment Method')).toBeOnTheScreen();
    });
    await waitFor(() => {
      expect(mockListSavingsGoals).toHaveBeenCalledTimes(1);
    });

    fireEvent.press(
      await screen.findByRole('button', {
        name: 'Mock use checkout savings',
      })
    );
    selectPaystackPayment();
    fireEvent.press(screen.getByRole('button', { name: 'Continue to review' }));

    await waitFor(() => {
      expect(screen.getByText('Review Order')).toBeOnTheScreen();
    });

    fireEvent.press(screen.getByRole('button', { name: /Place order for/i }));

    // Assert
    await waitFor(() => {
      expect(mockRouterReplace).toHaveBeenCalledWith({
        pathname: '/order-success',
        params: expect.objectContaining({
          orderId: 'order-full-savings',
          orderNumber: 'ORD-SAVE',
          paymentMethod: 'savings',
          savingsAmountUsed: '470000',
          trackingToken: 'track-1',
          walletAmountUsed: '0',
        }),
      });
    });
    expect(mockCreateOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        savings_amount: 470000,
        savings_goal_id: '123e4567-e89b-12d3-a456-426614174555',
        use_savings_credit: true,
      })
    );
    expect(getPaymentInitializeCalls()).toHaveLength(0);
  });

  it('surfaces checkout savings fetch failures with retry UI', async () => {
    // Arrange
    mockUseAuthStatus.mockReturnValue({
      customer: {
        email: 'ada@example.com',
        first_name: 'Ada',
        id: 'customer-1',
        last_name: 'Lovelace',
        phone: '08031234567',
      },
      isAuthenticated: true,
      isGuest: false,
      isInitialized: true,
      isLoading: false,
      user: { id: 'user-1' },
    });
    mockListSavingsGoals
      .mockRejectedValueOnce(new Error('Savings service unavailable'))
      .mockResolvedValueOnce({
        goals: [],
        summary: { activeGoalCount: 0, savingsBalance: 0 },
      });

    renderCheckoutScreen();

    // Act
    fillAddressAndContinueToPayment();

    // Assert
    expect(await screen.findByText('Savings unavailable')).toBeOnTheScreen();
    expect(screen.getByText('Savings service unavailable')).toBeOnTheScreen();
    expect(mockTrackError).toHaveBeenCalledWith(
      'checkout_savings_goals_fetch',
      'Savings service unavailable',
      expect.objectContaining({
        error_category: 'unknown',
        error_retryable: false,
        reload_attempt: 0,
        retry_count: 0,
      })
    );

    fireEvent.press(
      screen.getByRole('button', { name: 'Retry checkout savings' })
    );

    await waitFor(() => {
      expect(mockListSavingsGoals).toHaveBeenCalledTimes(2);
    });
  });

  it('routes eligible bank-transfer checkout through wallet funding intent without Paystack initialize', async () => {
    mockUseAuthStatus.mockReturnValue({
      customer: {
        email: 'ada@example.com',
        first_name: 'Ada',
        id: 'customer-1',
        last_name: 'Lovelace',
        phone: '08031234567',
      },
      isAuthenticated: true,
      isGuest: false,
      isInitialized: true,
      isLoading: false,
      user: { id: 'user-1' },
    });
    Object.assign(mockPaymentSettings, {
      wallet_order_auto_debit_enabled: true,
      wallet_paystack_dva_enabled: true,
    });

    renderCheckoutScreen();
    fillAddressAndContinueToPayment();

    await waitFor(() => {
      expect(screen.getByText('Bank transfer to wallet')).toBeOnTheScreen();
    });

    fireEvent.press(
      screen.getByRole('button', {
        name: 'Mock select Bank transfer to wallet',
      })
    );
    fireEvent.press(screen.getByRole('button', { name: 'Continue to review' }));

    await waitFor(() => {
      expect(screen.getByText('Review Order')).toBeOnTheScreen();
    });

    fireEvent.press(screen.getByRole('button', { name: /Place order for/i }));

    await waitFor(() => {
      expect(mockCreateOrderWalletFundingIntent).toHaveBeenCalledWith({
        merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
        merchantSlug: 'ogabassey',
        orderId: 'order-1',
      });
    });

    const orderPayload = mockCreateOrder.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(orderPayload).not.toHaveProperty('use_wallet_credit');
    expect(orderPayload).not.toHaveProperty('wallet_amount');

    expect(getPaymentInitializeCalls()).toHaveLength(0);
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/bank-transfer',
      params: expect.objectContaining({
        accountName: 'Ogabassey Jane',
        accountNumber: '9971002551',
        amount: '470000',
        bankName: 'Paystack-Titan',
        intentId: 'intent-123',
        orderId: 'order-1',
        orderNumber: 'ORD-001',
        walletFunded: 'true',
      }),
    });
  });

  it('automatically creates the wallet account and retries when checkout needs to create the wallet account without showing a popup', async () => {
    const consentError = createConsentError(
      'WALLET_DVA_CONSENT_REQUIRED',
      'Wallet DVA consent required'
    );
    mockCreateOrderWalletFundingIntent
      .mockRejectedValueOnce(consentError)
      .mockResolvedValueOnce({
        account: {
          accountName: 'Ogabassey Jane',
          accountNumber: '9971002551',
          bankName: 'Paystack-Titan',
          provider: 'paystack',
        },
        intent: {
          currency: 'NGN',
          expectedAmount: 470000,
          expiresAt: '2026-05-27T12:00:00.000Z',
          fundedAmount: 0,
          id: 'intent-123',
          orderId: 'order-1',
          status: 'pending',
          targetOrderAmount: 470000,
        },
      });
    mockUseAuthStatus.mockReturnValue({
      customer: {
        email: 'ada@example.com',
        first_name: 'Ada',
        id: 'customer-1',
        last_name: 'Lovelace',
        phone: '08031234567',
      },
      isAuthenticated: true,
      isGuest: false,
      isInitialized: true,
      isLoading: false,
      user: { id: 'user-1' },
    });
    Object.assign(mockPaymentSettings, {
      wallet_order_auto_debit_enabled: true,
      wallet_paystack_dva_enabled: true,
    });

    renderCheckoutScreen();
    fillAddressAndContinueToPayment();

    await waitFor(() => {
      expect(screen.getByText('Bank transfer to wallet')).toBeOnTheScreen();
    });

    fireEvent.press(
      screen.getByRole('button', {
        name: 'Mock select Bank transfer to wallet',
      })
    );
    fireEvent.press(screen.getByRole('button', { name: 'Continue to review' }));

    await waitFor(() => {
      expect(screen.getByText('Review Order')).toBeOnTheScreen();
    });

    fireEvent.press(screen.getByRole('button', { name: /Place order for/i }));

    await waitFor(() => {
      expect(mockCreateWalletFundingAccount).toHaveBeenCalledWith({
        merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
        merchantSlug: 'ogabassey',
      });
      expect(mockCreateOrderWalletFundingIntent).toHaveBeenLastCalledWith({
        merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
        merchantSlug: 'ogabassey',
        orderId: 'order-1',
      });
    });

    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('falls back to legacy bank transfer when wallet intent creation fails before consent', async () => {
    const setupError = createConsentError(
      'WALLET_DVA_SETUP_FAILED',
      'Wallet DVA setup failed'
    );
    mockCreateOrderWalletFundingIntent.mockRejectedValueOnce(setupError);
    enableAuthenticatedWalletFundedCheckout();

    await placeWalletFundedBankTransferOrder();

    await waitFor(() => {
      expect(mockAlert).toHaveBeenCalledWith(
        'Bank transfer unavailable',
        expect.stringContaining('standard bank transfer'),
        expect.any(Array)
      );
      expect(getPaymentInitializeCalls()).toHaveLength(1);
    });
    expect(mockCreateWalletFundingAccount).not.toHaveBeenCalled();
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/bank-transfer',
      params: expect.not.objectContaining({
        intentId: expect.any(String),
        walletFunded: 'true',
      }),
    });
  });

  it('falls back to legacy bank transfer when wallet account creation fails', async () => {
    const consentError = createConsentError(
      'WALLET_DVA_CONSENT_REQUIRED',
      'Wallet DVA consent required'
    );
    mockCreateOrderWalletFundingIntent.mockRejectedValueOnce(consentError);
    mockCreateWalletFundingAccount.mockRejectedValueOnce(
      new Error('Paystack unavailable')
    );
    enableAuthenticatedWalletFundedCheckout();

    await placeWalletFundedBankTransferOrder();

    await waitFor(() => {
      expect(mockCreateWalletFundingAccount).toHaveBeenCalledTimes(1);
      expect(mockCreateOrderWalletFundingIntent).toHaveBeenCalledTimes(1);
      expect(mockAlert).toHaveBeenCalledWith(
        'Bank transfer unavailable',
        'Bank transfer to wallet is temporarily unavailable. We will use the standard bank transfer option instead.',
        expect.any(Array)
      );
      expect(getPaymentInitializeCalls()).toHaveLength(1);
    });
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/bank-transfer',
      params: expect.not.objectContaining({
        intentId: expect.any(String),
        walletFunded: 'true',
      }),
    });
  });

  it('falls back to legacy Paystack DVA for guest bank-transfer checkout', async () => {
    Object.assign(mockPaymentSettings, {
      wallet_order_auto_debit_enabled: true,
      wallet_paystack_dva_enabled: true,
    });

    renderCheckoutScreen();
    fillAddressAndContinueToPayment();

    await waitFor(() => {
      expect(screen.getByText('Bank Transfer')).toBeOnTheScreen();
    });

    fireEvent.press(
      screen.getByRole('button', { name: 'Mock select Bank Transfer' })
    );
    fireEvent.press(screen.getByRole('button', { name: 'Continue to review' }));

    await waitFor(() => {
      expect(screen.getByText('Review Order')).toBeOnTheScreen();
    });

    fireEvent.press(screen.getByRole('button', { name: /Place order for/i }));

    await waitFor(() => {
      expect(getPaymentInitializeCalls()).toHaveLength(1);
    });
    expect(mockCreateOrderWalletFundingIntent).not.toHaveBeenCalled();
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/bank-transfer',
      params: expect.not.objectContaining({
        intentId: expect.any(String),
        walletFunded: 'true',
      }),
    });
  });
});
