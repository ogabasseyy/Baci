import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { QueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { createPaymentGatewayCompletionHandlers } from './payment-gateway-completion-handlers';
import type {
  PaymentGatewayRefs,
  PaymentGatewayStatus,
} from './payment-gateway-controller.types';

const mockBeginWalletTopUpCompletion = jest.fn();
const mockBeginSavingsAuthorizationCompletion = jest.fn();
const mockHandleVtuConfirmation = jest.fn();

jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
}));

jest.mock('./payment-gateway-completions', () => ({
  beginWalletTopUpCompletion: (...args: unknown[]) =>
    mockBeginWalletTopUpCompletion(...args),
  beginSavingsAuthorizationCompletion: (...args: unknown[]) =>
    mockBeginSavingsAuthorizationCompletion(...args),
}));

jest.mock('./use-vtu-payment-completion', () => ({
  handleVtuConfirmation: (...args: unknown[]) =>
    mockHandleVtuConfirmation(...args),
}));

function createRefs(
  status: PaymentGatewayStatus = 'ready'
): PaymentGatewayRefs {
  return {
    copiedGatewayTextRef: { current: null },
    isMountedRef: { current: true },
    loadTimeoutRef: { current: null },
    navigationTimeoutRef: { current: null },
    paymentCompletionStartedRef: { current: false },
    savingsAuthorizationAbortRef: { current: null },
    statusRef: { current: status },
    vtuConfirmationTokenRef: { current: 0 },
    webViewRef: { current: null },
  } as unknown as PaymentGatewayRefs;
}

function createInput(
  overrides: Record<string, unknown> = {},
  status: PaymentGatewayStatus = 'ready'
) {
  const refs = createRefs(status);
  return {
    refs,
    input: {
      amount: 5000,
      clearCart: jest.fn<() => void | Promise<void>>(),
      clearPendingLoadTimeout: jest.fn(),
      customerIdentifier: '08012345678',
      gateway: 'paystack' as const,
      merchantId: 'merchant-1',
      merchantSlug: 'demo',
      orderId: 'order-1',
      orderNumber: 'ORD-1',
      paymentKind: 'order' as const,
      queryClient: {} as QueryClient,
      reference: 'ref-1',
      refs,
      returnTo: undefined,
      scheduleDelayedNavigation: jest.fn((navigate: () => void) => navigate()),
      setErrorMessage: jest.fn(),
      setPaymentStatus: jest.fn(),
      trackingToken: 'track-1',
      utilityType: undefined,
      ...overrides,
    },
  };
}

describe('createPaymentGatewayCompletionHandlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('completes an order payment, clears the cart, and navigates to success', async () => {
    // Arrange
    const { input, refs } = createInput();
    const { beginPaymentCompletion } =
      createPaymentGatewayCompletionHandlers(input);

    // Act
    await beginPaymentCompletion();

    // Assert
    expect(refs.paymentCompletionStartedRef.current).toBe(true);
    expect(input.clearPendingLoadTimeout).toHaveBeenCalledTimes(1);
    expect(input.setPaymentStatus).toHaveBeenCalledWith('success');
    expect(input.clearCart).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/order-success',
        params: expect.objectContaining({
          orderId: 'order-1',
          orderNumber: 'ORD-1',
          paymentMethod: 'paystack',
          reference: 'ref-1',
          trackingToken: 'track-1',
        }),
      })
    );
  });

  it('ignores a second completion once one has already started', () => {
    // Arrange
    const { input, refs } = createInput();
    refs.paymentCompletionStartedRef.current = true;
    const { beginPaymentCompletion } =
      createPaymentGatewayCompletionHandlers(input);

    // Act
    beginPaymentCompletion();

    // Assert
    expect(input.clearCart).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('does not re-run completion when status is already success', () => {
    // Arrange
    const { input } = createInput({}, 'success');
    const { beginPaymentCompletion } =
      createPaymentGatewayCompletionHandlers(input);

    // Act
    beginPaymentCompletion();

    // Assert
    expect(input.setPaymentStatus).not.toHaveBeenCalled();
    expect(input.clearCart).not.toHaveBeenCalled();
  });

  it('delegates wallet top-ups to the wallet completion flow', () => {
    // Arrange
    const { input } = createInput({ paymentKind: 'wallet' });
    const { beginPaymentCompletion } =
      createPaymentGatewayCompletionHandlers(input);

    // Act
    beginPaymentCompletion();

    // Assert
    expect(mockBeginWalletTopUpCompletion).toHaveBeenCalledTimes(1);
    expect(input.clearCart).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('delegates savings authorizations to the savings completion flow', () => {
    // Arrange
    const { input } = createInput({ paymentKind: 'savings_auth' });
    const { beginPaymentCompletion } =
      createPaymentGatewayCompletionHandlers(input);

    // Act
    beginPaymentCompletion();

    // Assert
    expect(mockBeginSavingsAuthorizationCompletion).toHaveBeenCalledTimes(1);
  });

  it('runs the VTU confirmation flow for utility payments', () => {
    // Arrange
    const { input, refs } = createInput({ paymentKind: 'vtu' });
    const { beginPaymentCompletion } =
      createPaymentGatewayCompletionHandlers(input);

    // Act
    beginPaymentCompletion();

    // Assert
    expect(refs.paymentCompletionStartedRef.current).toBe(true);
    expect(input.setPaymentStatus).toHaveBeenCalledWith('processing');
    expect(mockHandleVtuConfirmation).toHaveBeenCalledTimes(1);
  });
});
