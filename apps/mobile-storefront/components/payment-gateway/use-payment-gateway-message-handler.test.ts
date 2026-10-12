import { expect, it, jest } from '@jest/globals';

const mockFactory = jest.fn<(...args: unknown[]) => unknown>();
jest.mock('./create-payment-gateway-message-handler', () => ({
  createPaymentGatewayMessageHandler: mockFactory,
}));
const { usePaymentGatewayMessageHandler } =
  require('./use-payment-gateway-message-handler') as typeof import('./use-payment-gateway-message-handler');
it('delegates message-handler creation through the compiler-safe hook', () => {
  const handler = jest.fn();
  mockFactory.mockReturnValue(handler);
  const input = {} as Parameters<typeof usePaymentGatewayMessageHandler>[0];
  expect(usePaymentGatewayMessageHandler(input)).toBe(handler);
  expect(mockFactory).toHaveBeenCalledWith(input);
});
