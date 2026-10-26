import { redirect } from 'next/navigation';
import { getMerchantForUser } from '@/lib/merchant-server';
import { asRoute } from '@/lib/routes';
import { createClient } from '@/lib/supabase/server';
import { loadXAdsConnection } from '@/lib/x-ads/load-connection';
import XAdsIntegrationClient from './client-page';

export default async function XAdsIntegrationPage() {
  const { user, merchant, staffAccess } = await getMerchantForUser();
  if (!user) redirect(asRoute('/login'));
  if (!merchant || !staffAccess.isOwner) {
    return <p role="alert">Only the store owner can manage this connection.</p>;
  }
  try {
    const initialConnection = await loadXAdsConnection(
      await createClient(),
      merchant.id
    );
    return (
      <XAdsIntegrationClient
        key={merchant.id}
        initialMerchantId={merchant.id}
        initialConnection={initialConnection}
      />
    );
  } catch {
    return (
      <p role="alert">
        Could not load your connection. Please refresh and try again.
      </p>
    );
  }
}
