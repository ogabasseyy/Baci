import { expect, it, jest } from '@jest/globals';

const mockFactory = jest.fn<(...args: unknown[]) => unknown>();
jest.mock('./payment-gateway-timers', () => ({
  createPaymentGatewayTimers: mockFactory,
}));
const { usePaymentGatewayTimers } =
  require('./use-payment-gateway-timers') as typeof import('./use-payment-gateway-timers');
it('delegates timer creation through the compiler-safe hook', () => {
  const timers = { clear: jest.fn() };
  mockFactory.mockReturnValue(timers);
  const input = {} as Parameters<typeof usePaymentGatewayTimers>[0];
  expect(usePaymentGatewayTimers(input)).toBe(timers);
  expect(mockFactory).toHaveBeenCalledWith(input);
});
