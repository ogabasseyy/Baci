import { z } from 'zod';

export interface ExpenseAccess {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canManageIntegrations: boolean;
}

const PermissionBooleanSchema = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return value;
  }
  if (typeof value !== 'string') return value;
  if (['true', 't', 'yes', 'y', 'on', '1'].includes(value.toLowerCase())) {
    return true;
  }
  if (['false', 'f', 'no', 'n', 'off', '0'].includes(value.toLowerCase())) {
    return false;
  }
  return value;
}, z.boolean());

const SUPPORTED_PERMISSION_RESOURCES = [
  '*',
  'expenses',
  'full_access',
  'integrations',
] as const;

type SupportedPermissionResource =
  (typeof SUPPORTED_PERMISSION_RESOURCES)[number];

export type ExpensePermissionMap = Partial<
  Record<SupportedPermissionResource, Record<string, boolean>>
>;

function parseSupportedPermissions(
  raw: Record<string, unknown>
): ExpensePermissionMap {
  const permissions: ExpensePermissionMap = {};

  for (const resource of SUPPORTED_PERMISSION_RESOURCES) {
    const actions = raw[resource];
    if (
      actions === undefined ||
      typeof actions !== 'object' ||
      actions === null
    ) {
      continue;
    }

    const parsedActions: Record<string, boolean> = {};
    for (const [action, value] of Object.entries(
      actions as Record<string, unknown>
    )) {
      const parsed = PermissionBooleanSchema.safeParse(value);
      if (parsed.success) {
        parsedActions[action] = parsed.data;
      }
    }

    if (Object.keys(parsedActions).length > 0) {
      permissions[resource] = parsedActions;
    }
  }

  return permissions;
}

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
    permissions: parseSupportedPermissions(row.permissions),
  }));

export type ExpenseAccessRow = z.infer<typeof ExpenseAccessRowSchema>;

function resolveGrant(
  permissions: ExpenseAccessRow['permissions'],
  resource: SupportedPermissionResource,
  action: string
): boolean {
  const grants = [
    permissions['*']?.['*'],
    permissions['*']?.[action],
    permissions[resource]?.['*'],
    permissions[resource]?.[action],
    permissions[resource]?.all,
    permissions.full_access?.all,
  ];

  return grants.find((grant) => grant !== undefined) ?? false;
}

export function resolveExpenseAccess(access: ExpenseAccessRow): ExpenseAccess {
  const canView = resolveGrant(access.permissions, 'expenses', 'view');

  return {
    canView,
    canCreate: resolveGrant(access.permissions, 'expenses', 'create'),
    canEdit: canView && resolveGrant(access.permissions, 'expenses', 'edit'),
    canManageIntegrations:
      access.is_owner ||
      resolveGrant(access.permissions, 'integrations', 'manage'),
  };
}
