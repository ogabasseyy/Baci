import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPlatformAdminAuthForPermission = vi.hoisted(() => vi.fn());

vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminAuthForPermission: (...args: unknown[]) =>
    getPlatformAdminAuthForPermission(...args),
}));

import { authorizeNotificationAdmin } from './admin-notification-auth';

describe('authorizeNotificationAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('authorizes a user with notification management access', async () => {
    getPlatformAdminAuthForPermission.mockResolvedValue({
      status: 'authenticated',
      user: { id: '123e4567-e89b-42d3-a456-426614174000' },
    });

    await expect(authorizeNotificationAdmin()).resolves.toEqual({
      status: 'authorized',
      userId: '123e4567-e89b-42d3-a456-426614174000',
    });
    expect(getPlatformAdminAuthForPermission).toHaveBeenCalledWith(
      'notifications.manage'
    );
  });

  it('returns a 401 response when no user is authenticated', async () => {
    getPlatformAdminAuthForPermission.mockResolvedValue({
      status: 'unauthenticated',
    });

    const result = await authorizeNotificationAdmin();

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.response.status).toBe(401);
      await expect(result.response.json()).resolves.toEqual({
        error: 'Unauthorized',
      });
    }
  });

  it('does not expose permission details when the user is forbidden', async () => {
    getPlatformAdminAuthForPermission.mockResolvedValue({
      status: 'forbidden',
    });

    const result = await authorizeNotificationAdmin();

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.response.status).toBe(403);
      await expect(result.response.json()).resolves.toEqual({
        error: 'Forbidden - notification management access required',
      });
    }
  });
});
