import { CHAT_REPLY_NOTIFICATION_CATEGORY } from '@baci/shared';
import { describe, expect, it, vi } from 'vitest';

// The reply handler's own dependencies are not under test here.
vi.mock('react-native', () => ({ Alert: { alert: vi.fn() } }));
vi.mock('@/lib/query-client', () => ({ queryClient: {} }));
vi.mock('@/lib/storage', () => ({ asyncStorage: {} }));
vi.mock('@/lib/api-client', () => ({
  apiClient: vi.fn(),
  NetworkError: Error,
}));
vi.mock('./push-notifications', () => ({
  getNotificationNavigationParams: vi.fn(),
}));

import { prepareChatNotifications } from './chat-notification-setup';

function notifications(overrides: Record<string, unknown> = {}) {
  return {
    AndroidImportance: { DEFAULT: 3, HIGH: 4, LOW: 2 },
    setNotificationCategoryAsync: vi.fn().mockResolvedValue(undefined),
    setNotificationChannelAsync: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Parameters<typeof prepareChatNotifications>[0] & {
    setNotificationCategoryAsync: ReturnType<typeof vi.fn>;
    setNotificationChannelAsync: ReturnType<typeof vi.fn>;
  };
}

describe('prepareChatNotifications', () => {
  it('registers the Reply box and, on Android, the channels, on every launch', async () => {
    const module = notifications();

    await prepareChatNotifications(module, { android: true });

    expect(module.setNotificationCategoryAsync).toHaveBeenCalledWith(
      CHAT_REPLY_NOTIFICATION_CATEGORY,
      expect.any(Array)
    );
    expect(module.setNotificationChannelAsync).toHaveBeenCalledWith(
      'messages',
      expect.objectContaining({ importance: 4 })
    );
  });

  it('creates no Android channels on iPhone', async () => {
    const module = notifications();

    await prepareChatNotifications(module, { android: false });

    expect(module.setNotificationCategoryAsync).toHaveBeenCalledTimes(1);
    expect(module.setNotificationChannelAsync).not.toHaveBeenCalled();
  });

  it('bugfix: still sets up the channels when the Reply box cannot be registered', async () => {
    const module = notifications({
      setNotificationCategoryAsync: vi.fn().mockRejectedValue(new Error('no')),
    });

    await expect(
      prepareChatNotifications(module, { android: true })
    ).resolves.toBeUndefined();

    expect(module.setNotificationChannelAsync).toHaveBeenCalledWith(
      'messages',
      expect.anything()
    );
  });

  it('still registers the Reply box when a channel cannot be created', async () => {
    const module = notifications({
      setNotificationChannelAsync: vi.fn().mockRejectedValue(new Error('no')),
    });

    await prepareChatNotifications(module, { android: true });

    expect(module.setNotificationCategoryAsync).toHaveBeenCalledTimes(1);
  });
});
