import { z } from 'zod';
import {
  parseStaffPermissionGrants,
  resolveStaffPermissionGrant,
  type StaffPermissionGrants,
} from './staff-permission-grants';

export interface ExpenseAccess {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canManageIntegrations: boolean;
}

const SUPPORTED_PERMISSION_RESOURCES = [
  '*',
  'expenses',
  'full_access',
  'integrations',
] as const;

type SupportedPermissionResource =
  (typeof SUPPORTED_PERMISSION_RESOURCES)[number];

export type ExpensePermissionMap =
  StaffPermissionGrants<SupportedPermissionResource>;

export const ExpenseAccessRowSchema = z
  .object({
    merchant_id: z.uuid(),
    is_owner: z.boolean(),
    is_staff: z.boolean(),
    role: z.string(),
    permissions: z.record(z.string(), z.unknown()),
  })
  .strict()
  .transform((row) => ({
    ...row,
    permissions: parseStaffPermissionGrants(
      row.permissions,
      SUPPORTED_PERMISSION_RESOURCES
    ),
  }));

export type ExpenseAccessRow = z.infer<typeof ExpenseAccessRowSchema>;

export function resolveExpenseAccess(access: ExpenseAccessRow): ExpenseAccess {
  const canView = resolveStaffPermissionGrant(
    access.permissions,
    'expenses',
    'view'
  );

  return {
    canView,
    canCreate: resolveStaffPermissionGrant(
      access.permissions,
      'expenses',
      'create'
    ),
    canEdit:
      canView &&
      resolveStaffPermissionGrant(access.permissions, 'expenses', 'edit'),
    canManageIntegrations:
      access.is_owner ||
      resolveStaffPermissionGrant(access.permissions, 'integrations', 'manage'),
  };
}
