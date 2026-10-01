import { redirect } from 'next/navigation';
import { getAdminPlatformAccessAuth } from '@/lib/admin-platform-access-auth';
import { AccessManagementClient } from './access-management-client';

export default async function AdminAccessPage() {
  const access = await getAdminPlatformAccessAuth();
  if (access.status === 'unauthenticated') {
    redirect('/login?redirect=%2Fadmin%2Faccess');
  }
  if (access.status === 'forbidden') {
    redirect('/admin');
  }
  return <AccessManagementClient />;
}
