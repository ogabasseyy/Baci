import { expect, it, jest } from '@jest/globals';

const mockFactory = jest.fn<(...args: unknown[]) => unknown>();
jest.mock('./payment-gateway-completion-handlers', () => ({
  createPaymentGatewayCompletionHandlers: mockFactory,
}));
const { usePaymentGatewayCompletionHandlers } =
  require('./use-payment-gateway-completion-handlers') as typeof import('./use-payment-gateway-completion-handlers');
it('preserves shared completion-handler wiring through the compiler-safe hook', () => {
  const handlers = {
    beginPaymentCompletion: jest.fn(),
    beginVtuPaymentCompletion: jest.fn(),
  };
  mockFactory.mockReturnValue(handlers);
  const input = {} as Parameters<typeof usePaymentGatewayCompletionHandlers>[0];
  expect(usePaymentGatewayCompletionHandlers(input)).toBe(handlers);
  expect(mockFactory).toHaveBeenCalledWith(input);
});
