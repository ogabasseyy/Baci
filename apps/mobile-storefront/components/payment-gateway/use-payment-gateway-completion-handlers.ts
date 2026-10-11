import { createPaymentGatewayCompletionHandlers } from './payment-gateway-completion-handlers';

export function usePaymentGatewayCompletionHandlers(
  input: Parameters<typeof createPaymentGatewayCompletionHandlers>[0]
) {
  return createPaymentGatewayCompletionHandlers(input);
}
