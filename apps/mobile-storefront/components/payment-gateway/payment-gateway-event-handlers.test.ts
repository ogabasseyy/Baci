import { describe, expect, it, jest } from '@jest/globals';
import type { PaymentGatewayRefs } from './payment-gateway-controller.types';
import { createPaymentGatewayEventHandlers } from './payment-gateway-event-handlers';

function createRefs(): PaymentGatewayRefs {
  return {
    copiedGatewayTextRef: { current: null },
    isMountedRef: { current: true },
    loadTimeoutRef: { current: null },
    navigationTimeoutRef: { current: null },
    paymentCompletionStartedRef: { current: false },
    savingsAuthorizationAbortRef: { current: null },
    statusRef: { current: 'ready' },
    vtuConfirmationTokenRef: { current: 0 },
    webViewRef: { current: null },
  } as unknown as PaymentGatewayRefs;
}

describe('REDVAULT gateway cancellation', () => {
  it('keeps the cart-owned completion flow idle after a hosted cancellation redirect', () => {
    const beginPaymentCompletion = jest.fn();
    const setPaymentStatus = jest.fn();
    const setErrorMessage = jest.fn();
    const handlers = createPaymentGatewayEventHandlers({
      beginPaymentCompletion,
      clearPendingLoadTimeout: jest.fn(),
      clearPendingNavigation: jest.fn(),
      paymentMethod: 'uba_redvault',
      refs: createRefs(),
      scheduleDelayedNavigation: jest.fn(),
      scheduleLoadTimeout: jest.fn(),
      setErrorMessage,
      setPaymentStatus,
    });

    handlers.handleNavigationChange({
      url: 'https://checkout.paystack.com/return?cancelled=true',
    } as never);

    expect(beginPaymentCompletion).not.toHaveBeenCalled();
    expect(setPaymentStatus).toHaveBeenCalledWith('error');
    expect(setErrorMessage).toHaveBeenCalledWith('Payment was cancelled.');
  });

  it('clears a prior verification error before retrying REDVAULT payment completion', () => {
    const setErrorMessage = jest.fn();
    const setPaymentStatus = jest.fn();
    const beginPaymentCompletion = jest.fn(() => {
      setPaymentStatus('pending');
    });
    const handlers = createPaymentGatewayEventHandlers({
      beginPaymentCompletion,
      clearPendingLoadTimeout: jest.fn(),
      clearPendingNavigation: jest.fn(),
      paymentMethod: 'uba_redvault',
      refs: createRefs(),
      scheduleDelayedNavigation: jest.fn(),
      scheduleLoadTimeout: jest.fn(),
      setErrorMessage,
      setPaymentStatus,
    });

    handlers.handleRetry();

    expect(setErrorMessage).toHaveBeenCalledWith(null);
    expect(beginPaymentCompletion).toHaveBeenCalledTimes(1);
    expect(setErrorMessage.mock.invocationCallOrder[0]).toBeLessThan(
      beginPaymentCompletion.mock.invocationCallOrder[0]
    );
    expect(setPaymentStatus).toHaveBeenCalledWith('pending');
  });
});
