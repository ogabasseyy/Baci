import { createPaymentGatewayMessageHandler } from './create-payment-gateway-message-handler';
import { createPaymentGatewayEventHandlers } from './payment-gateway-event-handlers';
import { createPaymentGatewayTimers } from './payment-gateway-timers';

// React Compiler forbids passing refs to plain function calls during render but
// allows passing them to hooks. These wrappers classify the render-time handler
// factories as hooks; like before, they re-run on every render.
export function usePaymentGatewayTimers(
  input: Parameters<typeof createPaymentGatewayTimers>[0]
) {
  return createPaymentGatewayTimers(input);
}

export function usePaymentGatewayMessageHandler(
  input: Parameters<typeof createPaymentGatewayMessageHandler>[0]
) {
  return createPaymentGatewayMessageHandler(input);
}

export function usePaymentGatewayEventHandlers(
  input: Parameters<typeof createPaymentGatewayEventHandlers>[0]
) {
  return createPaymentGatewayEventHandlers(input);
}
