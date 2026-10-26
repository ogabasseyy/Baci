import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import { chatgptAdsConnectionSchema } from '@/schemas/chatgpt-ads-settings';

// Caller must resolve owner authorization before loading these merchant rows.
// The key column is never selected, including during server rendering.
export async function loadChatgptAdsConnection(
  client: Awaited<ReturnType<typeof createClient>>,
  merchantId: string
) {
  const [settings, credential] = await Promise.all([
    client
      .from('merchant_feature_settings')
      .select('chatgpt_pixel_id')
      .eq('merchant_id', merchantId)
      .maybeSingle(),
    client
      .from('merchant_chatgpt_ads_credentials')
      .select('merchant_id')
      .eq('merchant_id', merchantId)
      .maybeSingle(),
  ]);
  if (settings.error || credential.error)
    throw new Error('chatgpt_connection_unavailable');
  return chatgptAdsConnectionSchema.parse({
    pixelId: settings.data?.chatgpt_pixel_id ?? null,
    capiConfigured: !!credential.data,
  });
}
