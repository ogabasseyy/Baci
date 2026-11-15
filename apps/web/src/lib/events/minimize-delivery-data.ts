import type { DomainEventV1 } from '@baci/shared/contracts';
import { isConversionEvent } from '@/lib/analytics/is-conversion-event';
import { toClientAnalyticsDomainEventName } from './event-route-registry';

/**
 * Shopper fields that exist only so an ad platform can match a conversion.
 * Everything here is personal data. Each group is kept only when the consent
 * that unlocks the destinations using it was granted:
 * - analytics consent -> Facebook / Google (Facebook cookie ids)
 * - marketing consent -> TikTok / Snapchat (their cookie and click ids)
 * - generic matching fields serve every destination, so either consent keeps them.
 */
const ANALYTICS_FIELDS = ['fbc', 'fbp'] as const;
const MARKETING_FIELDS = ['sccid', 'ttclid', 'ttp'] as const;
const SHARED_FIELDS = ['email', 'external_id', 'ip', 'phone', 'ua'] as const;

type PersonalDeliveryField =
  | (typeof ANALYTICS_FIELDS)[number]
  | (typeof MARKETING_FIELDS)[number]
  | (typeof SHARED_FIELDS)[number];

export type DeliveryData = {
  analytics_consent: boolean;
  marketing_consent: boolean;
} & Partial<Record<PersonalDeliveryField, string | undefined>>;

/** Client event names the router resolves to "no destination". */
const OBSERVATION_ONLY_NAMES = new Set([
  'analytics.client.observed.v1',
  'analytics.purchase.observed.v1',
]);

/**
 * Data minimisation at ingest: keep the shopper's personal matching fields
 * only when the event can fan out to an ad platform (a conversion-class event)
 * AND the client route for that event/trust level really has destinations
 * (client purchase/place_order and anonymous clients are observation-only)
 * AND, per field, the consent behind a destination that uses it was granted.
 * Otherwise only the two consent flags are kept, so the ledger and delivery
 * rows never hold personal data nothing can use.
 */
export function minimizeDeliveryData(
  data: DeliveryData,
  eventType: string,
  trustLevel: DomainEventV1['trust_level']
): DeliveryData {
  const minimal: DeliveryData = {
    analytics_consent: data.analytics_consent,
    marketing_consent: data.marketing_consent,
  };
  const canBeUsed =
    isConversionEvent(eventType) &&
    !OBSERVATION_ONLY_NAMES.has(
      toClientAnalyticsDomainEventName(eventType, trustLevel)
    );
  if (!canBeUsed) return minimal;
  const kept: PersonalDeliveryField[] = [];
  if (data.analytics_consent) kept.push(...ANALYTICS_FIELDS);
  if (data.marketing_consent) kept.push(...MARKETING_FIELDS);
  if (data.analytics_consent || data.marketing_consent) {
    kept.push(...SHARED_FIELDS);
  }
  const result: DeliveryData = { ...minimal };
  for (const field of kept) {
    if (data[field] !== undefined) result[field] = data[field];
  }
  return result;
}
