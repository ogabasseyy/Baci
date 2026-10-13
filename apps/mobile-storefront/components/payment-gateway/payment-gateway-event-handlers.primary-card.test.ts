import type { PaymentGatewayRefs } from './payment-gateway-controller.types';
import { createPaymentGatewayEventHandlers } from './payment-gateway-event-handlers';

jest.mock('@/services/analytics', () => ({
  trackCheckoutPaymentFailed: jest.fn(),
}));
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));

it.each([
  'pending',
  'error',
])('checks server status without reopening card checkout after %s', (status) => {
  const reload = jest.fn();
  const setPaymentStatus = jest.fn();
  const beginPaymentCompletion = jest.fn(() => {
    expect(setPaymentStatus).not.toHaveBeenCalledWith('loading');
  });
  const refs = {
    statusRef: { current: status },
    paymentCompletionStartedRef: { current: false },
    webViewRef: { current: { reload } },
  } as unknown as PaymentGatewayRefs;
  const handlers = createPaymentGatewayEventHandlers({
    paymentKind: 'primary_wallet_card',
    gateway: 'paystack',
    refs,
    beginPaymentCompletion,
    clearPendingLoadTimeout: jest.fn(),
    clearPendingNavigation: jest.fn(),
    scheduleDelayedNavigation: jest.fn(),
    scheduleLoadTimeout: jest.fn(),
    setErrorMessage: jest.fn(),
    setPaymentStatus,
  });
  handlers.handleRetry();
  expect(beginPaymentCompletion).toHaveBeenCalledTimes(1);
  expect(reload).not.toHaveBeenCalled();
  expect(setPaymentStatus).not.toHaveBeenCalledWith('loading');
});
