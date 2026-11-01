import { z } from 'zod';

/** The boolean spellings a staff permission JSON value may use. */
export const PermissionBooleanSchema = z.preprocess((value) => {
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

export type StaffPermissionGrants<Resource extends string> = Partial<
  Record<Resource, Record<string, boolean>>
>;

/**
 * Keeps only the listed resources from a get_user_access permissions object,
 * dropping any action whose value is not a recognisable boolean.
 */
export function parseStaffPermissionGrants<Resource extends string>(
  raw: Record<string, unknown>,
  resources: readonly Resource[]
): StaffPermissionGrants<Resource> {
  const permissions: StaffPermissionGrants<Resource> = {};

  for (const resource of resources) {
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

/**
 * Resolves one staff grant: the first defined value wins, in the same order as
 * the database check (public.check_staff_permission), so an explicit `false`
 * on a broader grant is not overridden by a narrower `true`.
 */
export function resolveStaffPermissionGrant(
  permissions: StaffPermissionGrants<string>,
  resource: string,
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
