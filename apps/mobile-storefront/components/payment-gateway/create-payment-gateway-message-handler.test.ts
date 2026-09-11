import { jest } from '@jest/globals';
import { waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { PAYMENT_CLIPBOARD_BRIDGE } from '@/constants/payment-clipboard-bridge';
import { createPaymentGatewayMessageHandler } from './create-payment-gateway-message-handler';
import { PAYMENT_KINDS } from './payment-gateway.helpers';

jest.mock('expo-router', () => ({
  router: {
    replace: jest.fn(),
  },
}));

function createHandler(
  overrides: Partial<
    Parameters<typeof createPaymentGatewayMessageHandler>[0]
  > = {}
) {
  const copiedGatewayTextRef = { current: null as string | null };
  const clearCart = jest.fn<() => void | Promise<void>>();
  const confirmVtuPaymentSuccess =
    jest.fn<
      (input: {
        amount: number;
        customerIdentifier?: string;
        reference: string;
      }) => void
    >();
  const copyGatewayText = jest.fn<
    (text: string, success: string, failure?: string) => Promise<void>
  >(() => Promise.resolve());
  const markPaymentCompletionStarted = jest.fn();
  const scheduleDelayedNavigation = jest.fn<(navigate: () => void) => void>();
  const setSuccessStatus = jest.fn();
  const handler = createPaymentGatewayMessageHandler({
    clearCart,
    confirmVtuPaymentSuccess,
    copiedGatewayTextRef,
    copyGatewayText,
    gateway: undefined,
    orderId: ' order-123 ',
    orderNumber: ' ORD-123 ',
    reference: ' ref-123 ',
    markPaymentCompletionStarted,
    scheduleDelayedNavigation,
    setSuccessStatus,
    ...overrides,
  });

  return {
    clearCart,
    confirmVtuPaymentSuccess,
    copiedGatewayTextRef,
    copyGatewayText,
    handler,
    markPaymentCompletionStarted,
    scheduleDelayedNavigation,
    setSuccessStatus,
  };
}

function sendMessage(
  handler: ReturnType<typeof createPaymentGatewayMessageHandler>,
  data: unknown
) {
  return handler({ nativeEvent: { data: JSON.stringify(data) } });
}

describe('createPaymentGatewayMessageHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('copies clipboard text once and trims the payload', async () => {
    const { copiedGatewayTextRef, copyGatewayText, handler } = createHandler();

    sendMessage(handler, {
      text: '  1234567890  ',
      type: PAYMENT_CLIPBOARD_BRIDGE.clipboardMessageType,
    });
    sendMessage(handler, {
      text: '1234567890',
      type: PAYMENT_CLIPBOARD_BRIDGE.clipboardMessageType,
    });

    expect(copyGatewayText).toHaveBeenCalledTimes(1);
    expect(copyGatewayText).toHaveBeenCalledWith(
      '1234567890',
      'Text copied.',
      undefined
    );
    await waitFor(() => {
      expect(copiedGatewayTextRef.current).toBe('1234567890');
    });
  });

  it('does not dedupe future clipboard messages when copy fails', async () => {
    const { copiedGatewayTextRef, copyGatewayText, handler } = createHandler();
    copyGatewayText
      .mockRejectedValueOnce(new Error('copy failed'))
      .mockResolvedValueOnce(undefined);

    sendMessage(handler, {
      text: '1234567890',
      type: PAYMENT_CLIPBOARD_BRIDGE.clipboardMessageType,
    });

    const firstCopy = copyGatewayText.mock.results[0]?.value;
    await expect(firstCopy).rejects.toThrow('copy failed');
    expect(copiedGatewayTextRef.current).toBeNull();

    sendMessage(handler, {
      text: '1234567890',
      type: PAYMENT_CLIPBOARD_BRIDGE.clipboardMessageType,
    });

    expect(copyGatewayText).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(copiedGatewayTextRef.current).toBe('1234567890');
    });
  });

  it('uses account-number specific copy messages', () => {
    const { copyGatewayText, handler } = createHandler();

    sendMessage(handler, {
      text: '1234567890',
      type: PAYMENT_CLIPBOARD_BRIDGE.accountNumberMessageType,
    });

    expect(copyGatewayText).toHaveBeenCalledWith(
      '1234567890',
      'Account number copied.',
      'Unable to copy account number.'
    );
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

  it('ignores invalid JSON and non-record messages', () => {
    const { copyGatewayText, handler } = createHandler();

    handler({ nativeEvent: { data: '{' } });
    sendMessage(handler, ['payment_clipboard_copy']);

    expect(copyGatewayText).not.toHaveBeenCalled();
  });
});
