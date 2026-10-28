import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import {
  xAdsConnectionSchema,
  xEventIdsSchema,
} from '@/schemas/x-ads-settings';
export async function loadXAdsConnection(
  client: Awaited<ReturnType<typeof createClient>>,
  merchantId: string
) {
  const [settings, credential] = await Promise.all([
    client
      .from('merchant_feature_settings')
      .select('twitter_pixel_id,twitter_event_ids')
      .eq('merchant_id', merchantId)
      .maybeSingle(),
    client
      .from('merchant_x_ads_credentials')
      .select('merchant_id')
      .eq('merchant_id', merchantId)
      .maybeSingle(),
  ]);
  if (settings.error || credential.error)
    throw new Error('x_connection_unavailable');
  const parsed = xEventIdsSchema.safeParse(settings.data?.twitter_event_ids);
  return xAdsConnectionSchema.parse({
    pixelId: settings.data?.twitter_pixel_id ?? null,
    eventIds: parsed.success ? parsed.data : {},
    capiConfigured: !!credential.data,
  });
}
