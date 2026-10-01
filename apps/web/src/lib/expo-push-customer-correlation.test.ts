import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSendPushNotificationsAsync = vi.fn();

vi.mock('expo-server-sdk', () => {
  class MockExpo {
    sendPushNotificationsAsync = mockSendPushNotificationsAsync;
    chunkPushNotifications = (messages: unknown[]) => [messages];

    static isExpoPushToken(token: unknown): boolean {
      return (
        typeof token === 'string' && token.startsWith('ExponentPushToken[')
      );
    }
  }
  return { default: MockExpo, Expo: MockExpo };
});

function createChainableMock(returnData: unknown = []) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  Object.defineProperty(chain, 'then', {
    value: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: returnData, error: null }).then(resolve),
  });
  return chain;
}

vi.mock('@/env', () => ({ getExpoAccessToken: () => 'test-expo-token' }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';

let notifyCustomer: typeof import('./expo-push').notifyCustomer;

beforeEach(async () => {
  vi.clearAllMocks();
  notifyCustomer = (await import('./expo-push')).notifyCustomer;
});

describe('notifyCustomer correlation', () => {
  it('persists the generated notification ID sent to Expo', async () => {
    const selectChain = createChainableMock([
      { token: 'ExponentPushToken[c1]' },
    ]);
    const ticketInsertChain = createChainableMock();
    const attemptInsertChain = createChainableMock();
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi
        .fn()
        .mockReturnValueOnce(selectChain)
        .mockReturnValueOnce(ticketInsertChain)
        .mockReturnValueOnce(attemptInsertChain),
    } as never);
    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      { status: 'ok', id: 'ticket-c1' },
    ]);

    await notifyCustomer('user-456', 'Order Update', 'Your order moved', {
      type: 'order_update',
      order_id: 'ord-1',
    });

    const sentMessage = mockSendPushNotificationsAsync.mock.calls[0]?.[0]?.[0];
    const persistedAttempt = attemptInsertChain.insert.mock.calls[0]?.[0];
    expect(sentMessage.data.notification_id).toEqual(expect.any(String));
    expect(persistedAttempt).toEqual(
      expect.objectContaining({
        user_id: 'user-456',
        title: 'Order Update',
        body: 'Your order moved',
        payload: expect.objectContaining({
          notification_id: sentMessage.data.notification_id,
        }),
        status: 'sent',
      })
    );
  });
});
