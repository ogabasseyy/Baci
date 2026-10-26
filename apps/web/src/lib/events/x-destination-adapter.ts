import type { DomainEventV1 } from '@baci/shared/contracts';
import { merchantHasFeature } from '@/lib/merchant-has-feature';
import type { ServiceRoleClient } from '@/lib/supabase/service';
import { buildXPaidEvent } from '@/lib/x-ads/paid-event';
import { sendXEvent } from '@/lib/x-ads/send-event';
import {
  xAdsCredentialsSchema,
  xEventIdsSchema,
} from '@/schemas/x-ads-settings';
import type { EventDestinationResult } from './event-destination';
import { loadPaidOrderDeliveryEvent } from './paid-order-delivery-event';

const skipped = (reason: string): EventDestinationResult => ({
  success: true,
  terminalOutcome: 'skipped',
  providerResponseId: reason,
});
/** Dedicated worker path: public observations never become paid X conversions. */
export async function deliverXPaidOrder(
  client: ServiceRoleClient,
  event: DomainEventV1,
  signal?: AbortSignal
): Promise<EventDestinationResult> {
  if (
    event.event_name !== 'analytics.purchase.completed.v1' ||
    !event.merchant_id ||
    !['worker', 'database'].includes(event.producer) ||
    !['server', 'database'].includes(event.trust_level)
  )
    return { success: false, errorCode: 'unsupported_event' };
  const { data: merchant, error: merchantError } = await client
    .from('merchants')
    .select(
      'plan_tier,plan_expires_at,premium_features,offline_conversions_enabled'
    )
    .eq('id', event.merchant_id)
    .maybeSingle();
  if (merchantError || !merchant)
    return { success: false, errorCode: 'analytics_config_unavailable' };
  if (
    !merchantHasFeature(merchant, 'growth_integrations') ||
    merchant.offline_conversions_enabled === false
  )
    return skipped('merchant_disabled');
  const { data: settings, error: settingsError } = await client
    .from('merchant_feature_settings')
    .select('twitter_pixel_id,twitter_event_ids')
    .eq('merchant_id', event.merchant_id)
    .maybeSingle();
  if (settingsError)
    return { success: false, errorCode: 'analytics_config_unavailable' };
  const ids = xEventIdsSchema.safeParse(settings?.twitter_event_ids);
  if (!settings?.twitter_pixel_id || !ids.success || !ids.data.purchase)
    return skipped('not_configured');
  const prepared = await loadPaidOrderDeliveryEvent(client, event);
  if (prepared.conversion.user_data.marketing_consent !== true)
    return skipped('consent_required');
  let payload: ReturnType<typeof buildXPaidEvent>;
  try {
    payload = buildXPaidEvent(
      prepared.conversion,
      settings.twitter_pixel_id,
      ids.data.purchase
    );
  } catch {
    return { success: false, errorCode: 'invalid_destination_payload' };
  }
  if (!payload) return skipped('matching_identifier_unavailable');
  const { data: credential, error: credentialError } = await client
    .from('merchant_x_ads_credentials')
    .select('consumer_key,consumer_secret,access_token,access_token_secret')
    .eq('merchant_id', event.merchant_id)
    .maybeSingle();
  if (credentialError)
    return { success: false, errorCode: 'analytics_config_unavailable' };
  const parsed = xAdsCredentialsSchema.safeParse(
    credential
      ? {
          consumerKey: credential.consumer_key,
          consumerSecret: credential.consumer_secret,
          accessToken: credential.access_token,
          accessTokenSecret: credential.access_token_secret,
        }
      : null
  );
  if (!parsed.success) return skipped('not_configured');
  return sendXEvent(settings.twitter_pixel_id, parsed.data, payload, signal);
}
