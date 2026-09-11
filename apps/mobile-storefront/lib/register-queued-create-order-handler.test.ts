import { jest } from '@jest/globals';
import { registerQueuedCreateOrderHandler } from './register-queued-create-order-handler';

const mockRegisterHandler = jest.fn();
const mockCreateOrder = jest.fn();
const mockReplay = jest.fn();
let mockUserId: string | undefined;

jest.mock('./offline-queue', () => ({
  offlineQueue: {
    registerHandler: (...args: unknown[]) => mockRegisterHandler(...args),
  },
}));

jest.mock('@/services/orders', () => ({
  createOrder: (...args: unknown[]) => mockCreateOrder(...args),
}));

jest.mock('./replay-queued-create-order', () => ({
  replayQueuedCreateOrder: (...args: unknown[]) => mockReplay(...args),
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({ user: mockUserId ? { id: mockUserId } : null }),
  },
}));

it('registers create_order replay with the current auth user', () => {
  mockUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  registerQueuedCreateOrderHandler();

  expect(mockRegisterHandler).toHaveBeenCalledWith(
    'create_order',
    expect.any(Function)
  );
  const handler = mockRegisterHandler.mock.calls[0]?.[1] as (
    payload: unknown
  ) => unknown;
  handler({ checkoutGeneration: 'cart-one' });
  expect(mockReplay).toHaveBeenCalledWith(
    expect.any(Function),
    { checkoutGeneration: 'cart-one' },
    mockUserId
  );
});
