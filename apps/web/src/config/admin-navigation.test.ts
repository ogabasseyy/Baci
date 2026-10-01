import { describe, expect, it } from 'vitest';
import { platformAdminRolePermissions } from '@/config/platform-admin-rbac';
import { getAdminNavigationItems } from './admin-navigation';

describe('getAdminNavigationItems', () => {
  it('includes every platform surface for owners', () => {
    const labels = getAdminNavigationItems(
      platformAdminRolePermissions.owner
    ).map((item) => item.label);

    expect(labels).toEqual([
      'Overview',
      'Merchants',
      'Analytics',
      'Reconciliation',
      'Operations',
      'Audit Log',
      'System Health',
      'Blog',
      'Notifications',
      'Template Catalogue',
      'Platform Settings',
      'Access',
    ]);
  });

  it('does not expose mutation or finance navigation to viewers', () => {
    const labels = getAdminNavigationItems(
      platformAdminRolePermissions.viewer
    ).map((item) => item.label);

    expect(labels).toEqual(['Overview', 'Merchants', 'Analytics']);
  });

  it('does not expose the analytics-backed overview to content admins', () => {
    const labels = getAdminNavigationItems(
      platformAdminRolePermissions.content
    ).map((item) => item.label);

    expect(labels).not.toContain('Overview');
  });

  it('shows finance the read-only reconciliation and audit surfaces', () => {
    const labels = getAdminNavigationItems(
      platformAdminRolePermissions.finance
    ).map((item) => item.label);

    expect(labels).toContain('Reconciliation');
    expect(labels).toContain('Audit Log');
    expect(labels).not.toContain('Access');
    expect(labels).not.toContain('Platform Settings');
  });
});
