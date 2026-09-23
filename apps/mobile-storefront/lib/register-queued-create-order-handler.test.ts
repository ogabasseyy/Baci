import { jest } from '@jest/globals';
import { registerQueuedCreateOrderHandler } from './register-queued-create-order-handler';

const mockRegisterHandler = jest.fn();
const mockProcessPending = jest.fn();
const mockReplay = jest.fn();
let mockUserId: string | undefined;
let mockAuthListener:
  | ((state: { user: { id: string } | null }) => void)
  | undefined;

jest.mock('./offline-queue', () => ({
  offlineQueue: {
    processPending: () => mockProcessPending(),
    registerHandler: (...args: unknown[]) => mockRegisterHandler(...args),
  },
}));

jest.mock('@/services/orders', () => ({
  createOrder: jest.fn(),
}));

jest.mock('./replay-queued-create-order', () => ({
  replayQueuedCreateOrder: (...args: unknown[]) => mockReplay(...args),
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({ user: mockUserId ? { id: mockUserId } : null }),
    subscribe: (listener: (state: { user: { id: string } | null }) => void) => {
      mockAuthListener = listener;
      return () => undefined;
    },
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

it('reprocesses the queue when the originating account signs back in', () => {
  mockUserId = undefined;
  mockProcessPending.mockClear();
  registerQueuedCreateOrderHandler();
  mockAuthListener?.({
    user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  });
  expect(mockProcessPending).toHaveBeenCalled();
});
