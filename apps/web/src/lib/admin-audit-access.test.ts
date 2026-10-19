import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetPlatformAdminAuthForPermission = vi.fn();

vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminAuthForPermission: (...args: unknown[]) =>
    mockGetPlatformAdminAuthForPermission(...args),
}));

import { getAdminAuditAccess } from './admin-audit-access';

describe('getAdminAuditAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the audit.read RBAC permission for finance and operations readers', async () => {
    mockGetPlatformAdminAuthForPermission.mockResolvedValue({
      context: { permissions: ['audit.read'], role: 'finance' },
      status: 'authenticated',
      user: { email: 'finance@example.test', id: 'user-id' },
    });

    await expect(getAdminAuditAccess()).resolves.toEqual({
      status: 'authorized',
    });
    expect(mockGetPlatformAdminAuthForPermission).toHaveBeenCalledWith(
      'audit.read'
    );
  });

  it('preserves a forbidden result for roles without audit.read', async () => {
    mockGetPlatformAdminAuthForPermission.mockResolvedValue({
      status: 'forbidden',
    });

    await expect(getAdminAuditAccess()).resolves.toEqual({
      status: 'forbidden',
    });
  });
});
