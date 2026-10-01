import { describe, expect, it } from 'vitest';
import {
  platformAdminPermissions,
  platformAdminRolePermissions,
  roleHasPlatformAdminPermission,
} from './platform-admin-rbac';

describe('platform admin RBAC mapping', () => {
  it('gives owners every named platform permission', () => {
    expect(platformAdminRolePermissions.owner).toEqual(
      platformAdminPermissions
    );
  });

  it('keeps finance and content permissions within their operating domains', () => {
    expect(roleHasPlatformAdminPermission('finance', 'financials.manage')).toBe(
      true
    );
    expect(roleHasPlatformAdminPermission('finance', 'content.manage')).toBe(
      false
    );
    expect(roleHasPlatformAdminPermission('content', 'content.manage')).toBe(
      true
    );
    expect(
      roleHasPlatformAdminPermission('content', 'notifications.manage')
    ).toBe(true);
    expect(roleHasPlatformAdminPermission('content', 'financials.read')).toBe(
      false
    );
  });

  it('reserves role assignment for the platform owner', () => {
    expect(roleHasPlatformAdminPermission('owner', 'roles.manage')).toBe(true);
    expect(roleHasPlatformAdminPermission('operations', 'roles.manage')).toBe(
      false
    );
  });
});
