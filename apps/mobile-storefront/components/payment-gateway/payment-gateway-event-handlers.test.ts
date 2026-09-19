import { beforeEach, describe, expect, it, jest } from '@jest/globals';
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

function createHandlers(reference?: string) {
  const beginPaymentCompletion = jest.fn();
  const handlers = createPaymentGatewayEventHandlers({
    beginPaymentCompletion,
    clearPendingLoadTimeout: jest.fn(),
    clearPendingNavigation: jest.fn(),
    paymentKind: 'order',
    reference,
    refs: createRefs(),
    returnTo: undefined,
    scheduleDelayedNavigation: jest.fn(),
    scheduleLoadTimeout: jest.fn(),
    setErrorMessage: jest.fn(),
    setPaymentStatus: jest.fn(),
  });
  return { beginPaymentCompletion, handlers };
}

describe('createPaymentGatewayEventHandlers navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('completes a redirect carrying the session reference', () => {
    const { beginPaymentCompletion, handlers } = createHandlers('ref-123');

    handlers.handleNavigationChange({
      url: 'https://checkout.paystack.com/orders?trxref=ref-123',
    } as never);

    expect(beginPaymentCompletion).toHaveBeenCalledTimes(1);
  });

  it('ignores a redirect carrying a foreign reference', () => {
    const { beginPaymentCompletion, handlers } = createHandlers('ref-123');

    handlers.handleNavigationChange({
      url: 'https://checkout.paystack.com/orders?trxref=ref-999',
    } as never);

    expect(beginPaymentCompletion).not.toHaveBeenCalled();
  });

  it('completes a bare success path without reference params', () => {
    const { beginPaymentCompletion, handlers } = createHandlers('ref-123');

    handlers.handleNavigationChange({
      url: 'https://usebaci.com/order-success',
    } as never);

    expect(beginPaymentCompletion).toHaveBeenCalledTimes(1);
  });
});
