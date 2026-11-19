import { describe, expect, it, vi } from 'vitest';
import { completeGiglTrackingNotification } from './gigl-tracking-notification-complete';

describe('completeGiglTrackingNotification', () => {
  it('completes through the lease-bound wrapper and reports success', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await expect(
      completeGiglTrackingNotification({ rpc }, 'n', 'w', 'skipped', 'why')
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('gigl_worker_complete_notification', {
      p_error: 'why',
      p_id: 'n',
      p_outcome: 'skipped',
      p_worker_id: 'w',
    });
  });

  it('reports a lost lease as not completed and throws database errors', async () => {
    const lost = vi.fn().mockResolvedValue({ data: false, error: null });
    const broken = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'down' } });

    await expect(
      completeGiglTrackingNotification({ rpc: lost }, 'n', 'w', 'sent')
    ).resolves.toBe(false);
    await expect(
      completeGiglTrackingNotification({ rpc: broken }, 'n', 'w', 'sent')
    ).rejects.toEqual({ message: 'down' });
  });
});
