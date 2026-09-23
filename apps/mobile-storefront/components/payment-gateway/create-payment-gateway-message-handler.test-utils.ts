import { jest } from '@jest/globals';
import { createPaymentGatewayMessageHandler } from './create-payment-gateway-message-handler';

export function createHandler(
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

export function sendMessage(
  handler: ReturnType<typeof createPaymentGatewayMessageHandler>,
  data: unknown
) {
  return handler({ nativeEvent: { data: JSON.stringify(data) } });
}
