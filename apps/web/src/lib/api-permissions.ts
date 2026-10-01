import { permissionGrantsAccess } from '@/lib/permission-grant';

export interface UserAccess {
  merchantId: string;
  role: string;
  isOwner: boolean;
  isStaff: boolean;
  permissions: Record<string, Record<string, boolean>>;
}

export function hasPermission(
  access: UserAccess,
  resource: string,
  action: string
): boolean {
  if (access.isOwner) return true;
  return permissionGrantsAccess(access.permissions, resource, action);
}
