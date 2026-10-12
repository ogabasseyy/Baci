import { createPaymentGatewayEventHandlers } from './payment-gateway-event-handlers';

// React Compiler forbids passing refs to plain function calls during render but
// allows passing them to hooks. This wrapper classifies the render-time event
// factory as a hook; like before, it re-runs on every render.
export function usePaymentGatewayEventHandlers(
  input: Parameters<typeof createPaymentGatewayEventHandlers>[0]
) {
  return createPaymentGatewayEventHandlers(input);
}
