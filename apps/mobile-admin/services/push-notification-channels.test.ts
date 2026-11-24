import { describe, expect, it, vi } from 'vitest';
import { setupAndroidChannels } from './push-notification-channels';

describe('setupAndroidChannels', () => {
  it('registers the expected Android channels with priority levels', async () => {
    const setNotificationChannelAsync = vi.fn().mockResolvedValue(undefined);
    const notifications = {
      AndroidImportance: { DEFAULT: 3, HIGH: 4, LOW: 2 },
      setNotificationChannelAsync,
    } as unknown as Parameters<typeof setupAndroidChannels>[0];

    await setupAndroidChannels(notifications);

    expect(setNotificationChannelAsync).toHaveBeenCalledTimes(5);
    expect(setNotificationChannelAsync).toHaveBeenCalledWith(
      'orders',
      expect.objectContaining({ importance: 4, name: 'New Orders' })
    );
    expect(setNotificationChannelAsync).toHaveBeenCalledWith(
      'general',
      expect.objectContaining({ importance: 2, name: 'General' })
    );
  });

  it('ignores missing notification modules', async () => {
    await expect(setupAndroidChannels(null)).resolves.toBeUndefined();
  });
});
