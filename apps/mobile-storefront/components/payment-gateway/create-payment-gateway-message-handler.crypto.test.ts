import { jest } from '@jest/globals';
import { router } from 'expo-router';
import {
  createHandler,
  sendMessage,
} from './create-payment-gateway-message-handler.test-utils';
import { PAYMENT_KINDS } from './payment-gateway.helpers';

jest.mock('expo-router', () => ({
  router: {
    replace: jest.fn(),
  },
}));

describe('createPaymentGatewayMessageHandler crypto success', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  it('routes crypto success with sanitized fallback params', async () => {
    const {
      clearCart,
      handler,
      markPaymentCompletionStarted,
      scheduleDelayedNavigation,
      setSuccessStatus,
    } = createHandler();

    await sendMessage(handler, { type: 'crypto_success' });

    expect(markPaymentCompletionStarted).toHaveBeenCalledTimes(1);
    expect(setSuccessStatus).toHaveBeenCalledTimes(1);
    expect(clearCart).toHaveBeenCalledTimes(1);
    expect(scheduleDelayedNavigation).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();

    const scheduledNavigation = scheduleDelayedNavigation.mock.calls[0]?.[0];
    expect(scheduledNavigation).toBeDefined();
    scheduledNavigation?.();
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/order-success',
      params: {
        orderId: 'order-123',
        orderNumber: 'ORD-123',
        paymentMethod: 'crypto',
        reference: 'ref-123',
      },
    });
  });

  it('preserves tracking token when routing order crypto success', async () => {
    const { handler, scheduleDelayedNavigation } = createHandler({
      trackingToken: ' track-token-123 ',
    });

    await sendMessage(handler, { type: 'crypto_success' });

    const scheduledNavigation = scheduleDelayedNavigation.mock.calls[0]?.[0];
    scheduledNavigation?.();

    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/order-success',
      params: {
        orderId: 'order-123',
        orderNumber: 'ORD-123',
        paymentMethod: 'crypto',
        reference: 'ref-123',
        trackingToken: 'track-token-123',
      },
    });
  });

  it('omits whitespace-only tracking token when routing order crypto success', async () => {
    const { handler, scheduleDelayedNavigation } = createHandler({
      trackingToken: '   ',
    });

    await sendMessage(handler, { type: 'crypto_success' });

    const scheduledNavigation = scheduleDelayedNavigation.mock.calls[0]?.[0];
    scheduledNavigation?.();

    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/order-success',
      params: {
        orderId: 'order-123',
        orderNumber: 'ORD-123',
        paymentMethod: 'crypto',
        reference: 'ref-123',
      },
    });
  });

  it('confirms VTU crypto success before routing to the utility result screen', () => {
    const {
      clearCart,
      confirmVtuPaymentSuccess,
      handler,
      markPaymentCompletionStarted,
      scheduleDelayedNavigation,
      setSuccessStatus,
    } = createHandler({
      amount: 2500,
      customerIdentifier: ' 43901766923 ',
      gateway: 'juicyway',
      paymentKind: PAYMENT_KINDS.VTU,
      reference: ' VTU-123 ',
      utilityType: 'power',
    });

    sendMessage(handler, {
      amount: '2750',
      customerIdentifier: ' 1234567890 ',
      reference: ' crypto-ref ',
      type: 'crypto_success',
    });

    expect(markPaymentCompletionStarted).not.toHaveBeenCalled();
    expect(setSuccessStatus).not.toHaveBeenCalled();
    expect(clearCart).not.toHaveBeenCalled();
    expect(scheduleDelayedNavigation).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(confirmVtuPaymentSuccess).toHaveBeenCalledWith({
      amount: 2750,
      customerIdentifier: '1234567890',
      reference: 'crypto-ref',
    });
  });

  it('falls back to route params when confirming VTU crypto success', () => {
    const { confirmVtuPaymentSuccess, handler } = createHandler({
      amount: 2500,
      customerIdentifier: ' 43901766923 ',
      paymentKind: PAYMENT_KINDS.VTU,
      reference: ' VTU-123 ',
      utilityType: 'power',
    });

    sendMessage(handler, {
      type: 'crypto_success',
    });

    expect(confirmVtuPaymentSuccess).toHaveBeenCalledWith({
      amount: 2500,
      customerIdentifier: '43901766923',
      reference: 'VTU-123',
    });
  });

  it('does not mark VTU crypto success as confirmed before backend confirmation', async () => {
    const {
      clearCart,
      confirmVtuPaymentSuccess,
      handler,
      markPaymentCompletionStarted,
      scheduleDelayedNavigation,
      setSuccessStatus,
    } = createHandler({
      amount: 2500,
      customerIdentifier: ' 43901766923 ',
      paymentKind: PAYMENT_KINDS.VTU,
      reference: ' VTU-123 ',
      utilityType: 'power',
    });

    sendMessage(handler, {
      type: 'crypto_success',
    });

    expect(confirmVtuPaymentSuccess).toHaveBeenCalledTimes(1);
    expect(markPaymentCompletionStarted).not.toHaveBeenCalled();
    expect(setSuccessStatus).not.toHaveBeenCalled();
    expect(clearCart).not.toHaveBeenCalled();
    expect(scheduleDelayedNavigation).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('does not route VTU crypto success without required route context', async () => {
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const {
      clearCart,
      confirmVtuPaymentSuccess,
      handler,
      markPaymentCompletionStarted,
      scheduleDelayedNavigation,
      setSuccessStatus,
    } = createHandler({
      amount: 0,
      paymentKind: PAYMENT_KINDS.VTU,
      reference: undefined,
      utilityType: undefined,
    });

    try {
      await sendMessage(handler, { type: 'crypto_success' });

      expect(markPaymentCompletionStarted).not.toHaveBeenCalled();
      expect(confirmVtuPaymentSuccess).not.toHaveBeenCalled();
      expect(setSuccessStatus).not.toHaveBeenCalled();
      expect(clearCart).not.toHaveBeenCalled();
      expect(scheduleDelayedNavigation).not.toHaveBeenCalled();
      expect(router.replace).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Unable to route VTU crypto payment success:',
        {
          amount: 0,
          hasReference: false,
          hasUtilityType: false,
        }
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('does not route order crypto success without order id or reference', () => {
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const {
      clearCart,
      handler,
      markPaymentCompletionStarted,
      scheduleDelayedNavigation,
      setSuccessStatus,
    } = createHandler({
      orderId: undefined,
      reference: undefined,
    });

    try {
      sendMessage(handler, {
        orderId: ' ',
        reference: ' ',
        type: 'crypto_success',
      });

      expect(markPaymentCompletionStarted).not.toHaveBeenCalled();
      expect(setSuccessStatus).not.toHaveBeenCalled();
      expect(clearCart).not.toHaveBeenCalled();
      expect(scheduleDelayedNavigation).not.toHaveBeenCalled();
      expect(router.replace).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Unable to route crypto payment success:',
        {
          hasOrderId: false,
          hasReference: false,
        }
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('does not swallow handler errors after a valid message is parsed', async () => {
    const { handler, setSuccessStatus } = createHandler();
    const failure = new Error('status failed');
    setSuccessStatus.mockImplementationOnce(() => {
      throw failure;
    });

    await expect(
      sendMessage(handler, { type: 'crypto_success' })
    ).rejects.toThrow(failure);
  });
});
