import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock expo-server-sdk
const mockSendPushNotificationsAsync = vi.fn();
const mockChunkPushNotifications = vi.fn((msgs: unknown[]) => [msgs]);
const mockChunkPushNotificationReceiptIds = vi.fn((ids: string[]) => [ids]);
const mockGetPushNotificationReceiptsAsync = vi.fn();

vi.mock('expo-server-sdk', () => {
  // Use a class so `new MockExpo()` survives vi.clearAllMocks()
  class MockExpo {
    sendPushNotificationsAsync = mockSendPushNotificationsAsync;
    chunkPushNotifications = mockChunkPushNotifications;
    chunkPushNotificationReceiptIds = mockChunkPushNotificationReceiptIds;
    getPushNotificationReceiptsAsync = mockGetPushNotificationReceiptsAsync;

    static isExpoPushToken(token: unknown): boolean {
      return (
        typeof token === 'string' && token.startsWith('ExponentPushToken[')
      );
    }
  }
  return { default: MockExpo, Expo: MockExpo };
});

// Mock Supabase admin client
function createChainableMock(
  returnData: unknown = [],
  returnError: unknown = null
) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const terminal = () =>
    Promise.resolve({ data: returnData, error: returnError });

  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.or = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  // Supabase query builder returns thenables — Object.defineProperty avoids biome noThenProperty
  Object.defineProperty(chain, 'then', {
    value: (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown
    ) => terminal().then(resolve, reject),
    writable: true,
    configurable: true,
  });

  return chain;
}

vi.mock('@/env', () => ({
  getExpoAccessToken: () => 'test-expo-token',
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/admin';

let notifyMerchant: typeof import('./expo-push').notifyMerchant;
beforeEach(async () => {
  vi.clearAllMocks();

  ({ notifyMerchant } = await import('./expo-push'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('notifyMerchant delivery outcome', () => {
  it('marks a rejected provider request as an unknown delivery', async () => {
    const mockChain = createChainableMock([{ token: 'ExponentPushToken[m1]' }]);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(mockChain),
    } as never);
    mockSendPushNotificationsAsync.mockRejectedValueOnce(
      new Error('network timeout')
    );

    const result = await notifyMerchant('merchant-123', 'Test', 'Body');

    expect(result).toMatchObject({
      sent: 0,
      failed: 1,
      deliveryOutcome: 'unknown',
    });
  });

  it('records a failed attempt when push sending throws before ticket processing', async () => {
    const selectChain = createChainableMock([
      { token: 'ExponentPushToken[m1]' },
      { token: 'ExponentPushToken[m2]' },
    ]);
    const attemptInsertChain = createChainableMock();

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi
        .fn()
        .mockReturnValueOnce(selectChain)
        .mockReturnValueOnce(attemptInsertChain),
    } as never);

    mockChunkPushNotifications.mockImplementationOnce(() => {
      throw new Error('Chunking failed');
    });

    const result = await notifyMerchant('merchant-123', 'Test', 'Body', {
      type: 'new_order',
    });

    expect(result).toEqual({
      sent: 0,
      failed: 2,
      errors: ['Chunking failed'],
      deliveryOutcome: 'unknown',
    });
    expect(attemptInsertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        merchant_id: 'merchant-123',
        title: 'Test',
        body: 'Body',
        payload: { type: 'new_order' },
        token_count: 2,
        failed_count: 2,
        status: 'failed',
      })
    );
  });
});
