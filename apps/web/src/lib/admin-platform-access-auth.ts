import { getPlatformAdminAuthForPermission } from '@/lib/platform-admin-auth';

export type AdminPlatformAccessAuth =
  | { status: 'authorized' }
  | { status: 'forbidden' }
  | { status: 'unauthenticated' };

export async function getAdminPlatformAccessAuth(): Promise<AdminPlatformAccessAuth> {
  const auth = await getPlatformAdminAuthForPermission('roles.manage');
  return auth.status === 'authenticated' ? { status: 'authorized' } : auth;
}
