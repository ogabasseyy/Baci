import { redirect } from 'next/navigation';
import { getPlatformAdminAuthForPermission } from '@/lib/platform-admin-auth';
import { CreateNotificationPageClient } from './create-notification-page-client';

export default async function CreateNotificationPage() {
  const auth = await getPlatformAdminAuthForPermission('notifications.manage');
  if (auth.status === 'unauthenticated') {
    redirect('/login?redirect=%2Fadmin');
  }

  if (auth.status === 'forbidden') {
    redirect('/dashboard');
  }

  return (
    <CreateNotificationPageClient
      canTargetSpecificMerchants={auth.context.permissions.includes(
        'merchants.read'
      )}
    />
  );
}
