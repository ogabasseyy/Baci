import { expect, it, jest } from '@jest/globals';

const mockFactory = jest.fn<(...args: unknown[]) => unknown>();
jest.mock('./payment-gateway-event-handlers', () => ({
  createPaymentGatewayEventHandlers: mockFactory,
}));
const { usePaymentGatewayEventHandlers } =
  require('./use-payment-gateway-event-handlers') as typeof import('./use-payment-gateway-event-handlers');
it('delegates event-handler creation through the compiler-safe hook', () => {
  const handlers = { onLoadStart: jest.fn() };
  mockFactory.mockReturnValue(handlers);
  const input = {} as Parameters<typeof usePaymentGatewayEventHandlers>[0];
  expect(usePaymentGatewayEventHandlers(input)).toBe(handlers);
  expect(mockFactory).toHaveBeenCalledWith(input);
});
