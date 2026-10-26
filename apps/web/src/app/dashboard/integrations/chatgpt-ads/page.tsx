import { redirect } from 'next/navigation';
import { loadChatgptAdsConnection } from '@/lib/chatgpt-ads/load-connection';
import { getMerchantForUser } from '@/lib/merchant-server';
import { asRoute } from '@/lib/routes';
import { createClient } from '@/lib/supabase/server';
import ChatgptIntegrationClient from './client-page';

export default async function ChatgptIntegrationPage() {
  const { user, merchant, staffAccess } = await getMerchantForUser();
  if (!user) redirect(asRoute('/login'));
  if (!merchant || !staffAccess.isOwner) {
    return <p role="alert">Only the store owner can manage this connection.</p>;
  }
  try {
    const initialConnection = await loadChatgptAdsConnection(
      await createClient(),
      merchant.id
    );
    return (
      <ChatgptIntegrationClient
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
