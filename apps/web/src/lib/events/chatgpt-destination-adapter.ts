import type { DomainEventV1 } from '@baci/shared/contracts';
import { buildChatgptPaidEvent } from '@/lib/chatgpt-ads/paid-event';
import { sendChatgptEvent } from '@/lib/chatgpt-ads/send-event';
import { merchantHasFeature } from '@/lib/merchant-has-feature';
import { buildStoreUrl } from '@/lib/store-url';
import type { ServiceRoleClient } from '@/lib/supabase/service';
import type { EventDestinationResult } from './event-destination';
import { loadPaidOrderDeliveryEvent } from './paid-order-delivery-event';

const skipped = (reason: string): EventDestinationResult => ({
  success: true,
  terminalOutcome: 'skipped',
  providerResponseId: reason,
});

// Runs inside the existing durable destination worker; no direct checkout,
// webhook, legacy-fanout or client-observation path sends ChatGPT conversions.
export async function deliverChatgptPaidOrder(
  client: ServiceRoleClient,
  event: DomainEventV1,
  signal?: AbortSignal
): Promise<EventDestinationResult> {
  if (
    event.event_name !== 'analytics.purchase.completed.v1' ||
    !event.merchant_id ||
    !['worker', 'database'].includes(event.producer) ||
    !['server', 'database'].includes(event.trust_level)
  ) {
    return { success: false, errorCode: 'unsupported_event' };
  }
  const { data: merchant, error: merchantError } = await client
    .from('merchants')
    .select(
      'slug, plan_tier, plan_expires_at, premium_features, offline_conversions_enabled'
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
    .select('chatgpt_pixel_id')
    .eq('merchant_id', event.merchant_id)
    .maybeSingle();
  if (settingsError)
    return { success: false, errorCode: 'analytics_config_unavailable' };
  if (!settings?.chatgpt_pixel_id) return skipped('not_configured');
  const prepared = await loadPaidOrderDeliveryEvent(client, event);
  if (prepared.conversion.user_data.measurement_consent !== true)
    return skipped('measurement_consent_denied');
  const { data: credential, error: credentialError } = await client
    .from('merchant_chatgpt_ads_credentials')
    .select('capi_key')
    .eq('merchant_id', event.merchant_id)
    .maybeSingle();
  if (credentialError)
    return { success: false, errorCode: 'analytics_config_unavailable' };
  if (!credential?.capi_key) return skipped('not_configured');
  const { data: domain, error: domainError } = await client
    .from('domains')
    .select('domain')
    .eq('merchant_id', event.merchant_id)
    .eq('is_primary', true)
    .eq('status', 'active')
    .maybeSingle();
  if (domainError || (!domain?.domain && !merchant.slug))
    return { success: false, errorCode: 'analytics_config_unavailable' };
  let payload: ReturnType<typeof buildChatgptPaidEvent>;
  try {
    payload = buildChatgptPaidEvent(
      prepared.conversion,
      buildStoreUrl({
        slug: merchant.slug ?? '',
        custom_domain: domain?.domain ?? undefined,
      })
    );
  } catch {
    return { success: false, errorCode: 'invalid_destination_payload' };
  }
  if (!payload) return skipped('measurement_consent_denied');
  const result = await sendChatgptEvent(
    settings.chatgpt_pixel_id,
    credential.capi_key,
    payload,
    signal
  );
  return result.success
    ? { success: true, terminalOutcome: 'delivered' }
    : {
        success: false,
        errorCode: result.error,
        httpStatus: result.httpStatus,
        // A lost response remains indeterminate until the provider drill proves
        // automatic replay safe; the existing worker handles delivery_unknown.
        requestMayHaveBeenSent: result.error === 'provider_transport_failed',
      };
}
