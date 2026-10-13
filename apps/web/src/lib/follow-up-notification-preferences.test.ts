import { describe, expect, it, vi } from 'vitest';
import { isFollowUpNotificationsEnabled } from './follow-up-notification-preferences';

function createClient(result: { data: unknown; error: unknown }) {
  return {
    rpc: vi.fn().mockResolvedValue(result),
  };
}

describe('isFollowUpNotificationsEnabled', () => {
  it('returns the stored preference when a merchant has opted out', async () => {
    const client = createClient({
      data: false,
      error: null,
    });

    const enabled = await isFollowUpNotificationsEnabled(
      client as never,
      'order-123'
    );

    expect(enabled).toBe(false);
    expect(client.rpc).toHaveBeenCalledWith(
      'get_follow_up_notification_preference',
      { p_order_id: 'order-123' }
    );
  });

  it('defaults to enabled when no preference row exists', async () => {
    const client = createClient({ data: null, error: null });

    await expect(
      isFollowUpNotificationsEnabled(client as never, 'order-123')
    ).resolves.toBe(true);
  });

  it('fails open when the preference lookup errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = createClient({
      data: null,
      error: { message: 'temporary database outage' },
    });

    await expect(
      isFollowUpNotificationsEnabled(client as never, 'order-123')
    ).resolves.toBe(true);
    expect(warn).toHaveBeenCalledWith(
      '[notifications] Failed to read follow-up alert preference; keeping alerts enabled',
      'temporary database outage'
    );
    warn.mockRestore();
  });
});
