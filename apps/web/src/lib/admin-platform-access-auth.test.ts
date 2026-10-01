import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPlatformAdminAuthForPermission = vi.fn();

vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminAuthForPermission: (...args: unknown[]) =>
    getPlatformAdminAuthForPermission(...args),
}));

import { getAdminPlatformAccessAuth } from './admin-platform-access-auth';

describe('getAdminPlatformAccessAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires the owner-only roles.manage permission', async () => {
    getPlatformAdminAuthForPermission.mockResolvedValue({
      context: { permissions: ['roles.manage'], role: 'owner' },
      status: 'authenticated',
      user: { email: 'owner@example.test', id: 'owner-id' },
    });

    await expect(getAdminPlatformAccessAuth()).resolves.toEqual({
      status: 'authorized',
    });
    expect(getPlatformAdminAuthForPermission).toHaveBeenCalledWith(
      'roles.manage'
    );
  });

  it('preserves unauthenticated and forbidden results', async () => {
    getPlatformAdminAuthForPermission.mockResolvedValueOnce({
      status: 'unauthenticated',
    });
    await expect(getAdminPlatformAccessAuth()).resolves.toEqual({
      status: 'unauthenticated',
    });

    getPlatformAdminAuthForPermission.mockResolvedValueOnce({
      status: 'forbidden',
    });
    await expect(getAdminPlatformAccessAuth()).resolves.toEqual({
      status: 'forbidden',
    });
  });
});
