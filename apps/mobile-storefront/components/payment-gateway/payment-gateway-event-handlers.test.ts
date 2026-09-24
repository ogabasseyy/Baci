import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { trackCheckoutPaymentFailed } from '@/services/analytics';
import type { PaymentGatewayRefs } from './payment-gateway-controller.types';
import { createPaymentGatewayEventHandlers } from './payment-gateway-event-handlers';

jest.mock('@/services/analytics', () => ({
  trackCheckoutPaymentFailed: jest.fn(),
}));

jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
}));

function createRefs(): PaymentGatewayRefs {
  return {
    copiedGatewayTextRef: { current: null },
    isMountedRef: { current: true },
    loadTimeoutRef: { current: null },
    navigationTimeoutRef: { current: null },
    paymentCompletionStartedRef: { current: false },
    paymentFailureRecordedRef: { current: false },
    paymentFailureReferenceRef: { current: undefined },
    savingsAuthorizationAbortRef: { current: null },
    statusRef: { current: 'ready' },
    vtuConfirmationTokenRef: { current: 0 },
    webViewRef: { current: null },
  } as unknown as PaymentGatewayRefs;
}

function createHandlers(
  reference?: string,
  refs = createRefs(),
  paymentKind = 'order'
) {
  const beginPaymentCompletion = jest.fn();
  const scheduleDelayedNavigation = jest.fn();
  const handlers = createPaymentGatewayEventHandlers({
    beginPaymentCompletion,
    clearPendingLoadTimeout: jest.fn(),
    clearPendingNavigation: jest.fn(),
    gateway: 'paystack',
    orderId: 'order-1',
    paymentKind,
    reference,
    refs,
    returnTo: undefined,
    scheduleDelayedNavigation,
    scheduleLoadTimeout: jest.fn(),
    setErrorMessage: jest.fn(),
    setPaymentStatus: jest.fn(),
  });
  return { beginPaymentCompletion, handlers, scheduleDelayedNavigation };
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

  it('records a terminal failure when the provider page is cancelled', () => {
    const { beginPaymentCompletion, handlers } = createHandlers('ref-123');

    handlers.handleNavigationChange({
      url: 'https://checkout.paystack.com/orders?cancelled=true',
    } as never);

    expect(beginPaymentCompletion).not.toHaveBeenCalled();
    expect(trackCheckoutPaymentFailed).toHaveBeenCalledWith(
      'payment_gateway_cancelled',
      'order-1',
      'paystack',
      'ref-123'
    );
  });

  it('records a terminal failure when the provider page fails to load', () => {
    const { handlers } = createHandlers('ref-123');

    handlers.handleWebViewError({
      nativeEvent: {
        description: 'net::ERR_FAILED',
        url: 'https://checkout.paystack.com/orders?trxref=ref-123',
      },
    } as never);

    expect(trackCheckoutPaymentFailed).toHaveBeenCalledWith(
      'payment_gateway_load_error',
      'order-1',
      'paystack',
      'ref-123'
    );
  });

  it('emits a single failure for duplicate cancellation callbacks', () => {
    const { handlers } = createHandlers('ref-123');
    const cancelledUrl = 'https://checkout.paystack.com/orders?cancelled=true';

    handlers.handleNavigationChange({ url: cancelledUrl } as never);
    handlers.handleNavigationChange({ url: cancelledUrl } as never);

    expect(trackCheckoutPaymentFailed).toHaveBeenCalledTimes(1);
  });

  it('dedupes a duplicate failure after the factory is recreated on rerender', () => {
    const { trackCheckoutPaymentFailed: failedMock } = jest.requireMock(
      '@/services/analytics'
    ) as { trackCheckoutPaymentFailed: jest.Mock };
    failedMock.mockClear();
    // One shared controller refs object across two factory instances models
    // the rerender that follows the first setPaymentStatus('error').
    const refs = createRefs();
    const cancelledUrl = 'https://checkout.paystack.com/orders?cancelled=true';
    createHandlers('ref-123', refs).handlers.handleNavigationChange({
      url: cancelledUrl,
    } as never);
    createHandlers('ref-123', refs).handlers.handleNavigationChange({
      url: cancelledUrl,
    } as never);

    expect(failedMock).toHaveBeenCalledTimes(1);
  });

  it('emits a single failure for duplicate load-error callbacks', () => {
    const { trackCheckoutPaymentFailed: failedMock } = jest.requireMock(
      '@/services/analytics'
    ) as { trackCheckoutPaymentFailed: jest.Mock };
    failedMock.mockClear();
    const { handlers } = createHandlers('ref-123');
    const loadError = {
      nativeEvent: {
        description: 'net::ERR_FAILED',
        url: 'https://checkout.paystack.com/orders?trxref=ref-123',
      },
    } as never;

    handlers.handleWebViewError(loadError);
    handlers.handleWebViewError(loadError);

    expect(failedMock).toHaveBeenCalledTimes(1);
  });

  it('emits a single failure across a same-reference Retry', () => {
    const { trackCheckoutPaymentFailed: failedMock } = jest.requireMock(
      '@/services/analytics'
    ) as { trackCheckoutPaymentFailed: jest.Mock };
    failedMock.mockClear();
    const { handlers } = createHandlers('ref-123');

    // Retry reloads the same authorization URL and reference without a
    // new checkout start: the second reload failure must not emit beside
    // the first for the one started attempt.
    handlers.handleNavigationChange({
      url: 'https://checkout.paystack.com/orders?cancelled=true',
    } as never);
    handlers.handleRetry();
    handlers.handleWebViewError({
      nativeEvent: {
        description: 'net::ERR_FAILED',
        url: 'https://checkout.paystack.com/orders?trxref=ref-123',
      },
    } as never);

    expect(failedMock).toHaveBeenCalledTimes(1);
    expect(failedMock).toHaveBeenCalledWith(
      'payment_gateway_cancelled',
      'order-1',
      'paystack',
      'ref-123'
    );
  });

  it('allows a fresh failure after Retry with a new reference', () => {
    const { trackCheckoutPaymentFailed: failedMock } = jest.requireMock(
      '@/services/analytics'
    ) as { trackCheckoutPaymentFailed: jest.Mock };
    failedMock.mockClear();
    const refs = createRefs();
    const first = createHandlers('ref-123', refs);

    first.handlers.handleWebViewError({
      nativeEvent: {
        description: 'net::ERR_FAILED',
        url: 'https://checkout.paystack.com/orders?trxref=ref-123',
      },
    } as never);

    // A new reference is a genuinely new attempt: Retry may reset.
    const second = createHandlers('ref-456', refs);
    second.handlers.handleRetry();
    second.handlers.handleWebViewError({
      nativeEvent: {
        description: 'net::ERR_FAILED',
        url: 'https://checkout.paystack.com/orders?trxref=ref-456',
      },
    } as never);

    expect(failedMock).toHaveBeenCalledTimes(2);
  });
});

describe('createPaymentGatewayEventHandlers non-order kinds', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    'vtu',
    'wallet',
    'savings_auth',
  ])('keeps a %s cancellation out of the checkout funnel', (paymentKind) => {
    const { handlers } = createHandlers('ref-123', createRefs(), paymentKind);

    handlers.handleNavigationChange({
      url: 'https://checkout.paystack.com/orders?cancelled=true',
    } as never);

    expect(trackCheckoutPaymentFailed).not.toHaveBeenCalled();
  });

  it.each([
    'vtu',
    'wallet',
    'savings_auth',
  ])('keeps a %s load error out of the checkout funnel', (paymentKind) => {
    const { handlers } = createHandlers('ref-123', createRefs(), paymentKind);

    handlers.handleWebViewError({
      nativeEvent: {
        description: 'net::ERR_FAILED',
        url: 'https://checkout.paystack.com/topup',
      },
    } as never);

    expect(trackCheckoutPaymentFailed).not.toHaveBeenCalled();
  });

  it('still returns a cancelled savings authorization to wallet setup', () => {
    const { handlers, scheduleDelayedNavigation } = createHandlers(
      'ref-123',
      createRefs(),
      'savings_auth'
    );

    handlers.handleNavigationChange({
      url: 'https://checkout.paystack.com/orders?cancelled=true',
    } as never);

    expect(trackCheckoutPaymentFailed).not.toHaveBeenCalled();
    expect(scheduleDelayedNavigation).toHaveBeenCalledTimes(1);
  });
});

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
