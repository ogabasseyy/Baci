import { jest } from '@jest/globals';
import { waitFor } from '@testing-library/react-native';
import { DeferredOfflineMutationError } from './deferred-offline-mutation-error';

const mockStorage = new Map<string, string>();

jest.mock('@/lib/storage', () => ({
  asyncStorage: {
    getItem: async (key: string) => mockStorage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      mockStorage.set(key, value);
    },
  },
}));

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: () => () => undefined,
  fetch: async () => ({ isConnected: true, isInternetReachable: true }),
}));

jest.mock('expo-crypto', () => ({
  randomUUID: () => '11111111-1111-4111-8111-111111111111',
}));

describe('bugfix: owner-mismatched queued checkouts stay durable', () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  it('keeps the mutation persisted without consuming retry budget', async () => {
    const { offlineQueue } =
      require('./offline-queue') as typeof import('./offline-queue');
    offlineQueue.destroy();
    await offlineQueue.initialize();
    offlineQueue.registerHandler('create_order', async () => {
      throw new DeferredOfflineMutationError(
        'Queued checkout belongs to a different account'
      );
    });

    await offlineQueue.enqueue('create_order', { request: { id: 'a' } });

    await waitFor(() => {
      expect(offlineQueue.getState().isProcessing).toBe(false);
    });

    expect(offlineQueue.getPendingCount('create_order')).toBe(1);
    expect(offlineQueue.getState().queue[0]?.retryCount).toBe(0);

    offlineQueue.destroy();
    await offlineQueue.initialize();
    expect(offlineQueue.getPendingCount('create_order')).toBe(1);
  });
});
