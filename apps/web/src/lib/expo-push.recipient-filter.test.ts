import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.fn();
vi.mock('expo-server-sdk', () => {
  class MockExpo {
    sendPushNotificationsAsync = mockSend;
    chunkPushNotifications = (m: unknown[]) => [m];
    static isExpoPushToken(t: unknown) {
      return typeof t === 'string' && t.startsWith('ExponentPushToken[');
    }
  }
  return { default: MockExpo, Expo: MockExpo };
});
vi.mock('@/env', () => ({ getExpoAccessToken: () => 'tok' }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';

function chain(data: unknown) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['select', 'eq', 'gte', 'in', 'insert', 'update', 'order']) {
    c[m] = vi.fn().mockReturnValue(c);
  }
  Object.defineProperty(c, 'then', {
    value: (r: (v: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(r),
  });
  return c;
}

describe('bugfix: merchant pushes reached every admin token', () => {
  beforeEach(() => vi.clearAllMocks());

  it('restricts the token query to the given recipient user ids', async () => {
    const tokens = chain([]);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(tokens),
    } as never);
    const { notifyMerchant } = await import('./expo-push');
    await notifyMerchant('m1', 't', 'b', undefined, 'orders', {
      recipientUserIds: ['u1', 'u2'],
    });
    expect(tokens.in).toHaveBeenCalledWith('user_id', ['u1', 'u2']);
  });

  it('sends nothing and skips the token query for an empty recipient list', async () => {
    const from = vi.fn().mockReturnValue(chain([]));
    vi.mocked(createAdminClient).mockReturnValue({ from } as never);
    const { notifyMerchant } = await import('./expo-push');
    const result = await notifyMerchant('m1', 't', 'b', undefined, 'orders', {
      recipientUserIds: [],
    });
    expect(result).toEqual({ sent: 0, failed: 0, errors: [] });
    expect(mockSend).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalledWith('push_tokens');
  });

  it('keeps targeting every admin token when no recipient list is given', async () => {
    const tokens = chain([]);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(tokens),
    } as never);
    const { notifyMerchant } = await import('./expo-push');
    await notifyMerchant('m1', 't', 'b', undefined, 'orders');
    expect(tokens.in).not.toHaveBeenCalled();
  });
});
