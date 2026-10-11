import { createPaymentGatewayMessageHandler } from './create-payment-gateway-message-handler';

// React Compiler forbids passing refs to plain function calls during render but
// allows passing them to hooks. This wrapper classifies the render-time message
// factory as a hook; like before, it re-runs on every render.
export function usePaymentGatewayMessageHandler(
  input: Parameters<typeof createPaymentGatewayMessageHandler>[0]
) {
  return createPaymentGatewayMessageHandler(input);
}
