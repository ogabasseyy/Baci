/**
 * Platform access is intentionally independent from merchant owner and staff
 * roles. Keep this list mirrored by the database resolver in
 * `20260805150000_platform_admin_rbac.sql`.
 */
export const platformAdminRoles = [
  'owner',
  'finance',
  'operations',
  'support',
  'content',
  'viewer',
] as const;

export type PlatformAdminRole = (typeof platformAdminRoles)[number];

export const platformAdminPermissions = [
  'platform.read',
  'analytics.read',
  'audit.read',
  'content.manage',
  'financials.read',
  'financials.manage',
  'merchants.read',
  'merchants.manage',
  'notifications.manage',
  'operations.read',
  'operations.manage',
  'roles.manage',
  'settings.read',
  'settings.manage',
] as const;

export type PlatformAdminPermission = (typeof platformAdminPermissions)[number];

export const platformAdminRolePermissions: Readonly<
  Record<PlatformAdminRole, readonly PlatformAdminPermission[]>
> = {
  owner: platformAdminPermissions,
  finance: [
    'platform.read',
    'analytics.read',
    'audit.read',
    'financials.read',
    'financials.manage',
    'merchants.read',
  ],
  operations: [
    'platform.read',
    'analytics.read',
    'audit.read',
    'merchants.read',
    'merchants.manage',
    'operations.read',
    'operations.manage',
  ],
  support: [
    'platform.read',
    'analytics.read',
    'merchants.read',
    'notifications.manage',
    'operations.read',
  ],
  content: ['platform.read', 'content.manage', 'notifications.manage'],
  viewer: ['platform.read', 'analytics.read', 'merchants.read'],
};

export function roleHasPlatformAdminPermission(
  role: PlatformAdminRole,
  permission: PlatformAdminPermission
): boolean {
  return platformAdminRolePermissions[role].includes(permission);
}
