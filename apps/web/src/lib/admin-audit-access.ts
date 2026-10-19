import { getPlatformAdminAuthForPermission } from '@/lib/platform-admin-auth';

export type AdminAuditAccess =
  | { status: 'authorized' }
  | { status: 'forbidden' }
  | { status: 'unauthenticated' };

/**
 * Audit readers are resolved through the RBAC bridge, which keeps legacy owners
 * compatible and grants Finance/Operations the exact audit.read capability.
 */
export async function getAdminAuditAccess(): Promise<AdminAuditAccess> {
  const auth = await getPlatformAdminAuthForPermission('audit.read');
  if (auth.status === 'authenticated') {
    return { status: 'authorized' };
  }
  return auth;
}
