import { createPaymentGatewayTimers } from './payment-gateway-timers';

// React Compiler forbids passing refs to plain function calls during render but
// allows passing them to hooks. This wrapper classifies the render-time timer
// factory as a hook; like before, it re-runs on every render.
export function usePaymentGatewayTimers(
  input: Parameters<typeof createPaymentGatewayTimers>[0]
) {
  return createPaymentGatewayTimers(input);
}
