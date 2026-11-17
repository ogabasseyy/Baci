import type { DomainEventV1 } from '@baci/shared/contracts';
import type { AdPlatformTarget } from '@/lib/analytics/ad-platform-target';
import { isConversionEvent } from '@/lib/analytics/is-conversion-event';
import { toClientAnalyticsDomainEventName } from './event-route-registry';
import { CLIENT_OBSERVATION_ONLY_EVENTS } from './event-route-resolution';

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
/** Which ad platform reads each platform-specific field. */
const PLATFORM_FIELDS: Record<
  AdPlatformTarget,
  readonly PersonalDeliveryField[]
> = {
  facebook: ['fbc', 'fbp'],
  google: [],
  snapchat: ['sccid'],
  tiktok: ['ttclid', 'ttp'],
};
const SHARED_FIELDS = ['email', 'external_id', 'ip', 'phone', 'ua'] as const;

type PersonalDeliveryField =
  | (typeof ANALYTICS_FIELDS)[number]
  | (typeof MARKETING_FIELDS)[number]
  | (typeof SHARED_FIELDS)[number];

export type DeliveryData = {
  analytics_consent: boolean;
  marketing_consent: boolean;
} & Partial<Record<PersonalDeliveryField, string | undefined>>;

/**
 * Data minimisation at ingest: keep the shopper's personal matching fields
 * only when the event can fan out to an ad platform (a conversion-class event)
 * AND the client route for that event/trust level really has destinations
 * (client purchase/place_order and anonymous clients are observation-only)
 * AND, per field, the consent behind a destination that uses it was granted.
 * When the caller passes the resolved `targets`, only fields those platforms
 * read are kept (no targets: nothing but the consent flags).
 * Otherwise only the two consent flags are kept, so the ledger and delivery
 * rows never hold personal data nothing can use.
 */
export function minimizeDeliveryData(
  data: DeliveryData,
  eventType: string,
  trustLevel: DomainEventV1['trust_level'],
  targets?: readonly AdPlatformTarget[]
): DeliveryData {
  const minimal: DeliveryData = {
    analytics_consent: data.analytics_consent,
    marketing_consent: data.marketing_consent,
  };
  const canBeUsed =
    isConversionEvent(eventType) &&
    !CLIENT_OBSERVATION_ONLY_EVENTS.has(
      toClientAnalyticsDomainEventName(eventType, trustLevel)
    );
  if (!canBeUsed) return minimal;
  const kept: PersonalDeliveryField[] = [];
  if (targets) {
    // The caller narrowed the destinations: keep only what those platforms read
    // (the targets are already consent-filtered by clientMarketingTargets).
    if (targets.length > 0) kept.push(...SHARED_FIELDS);
    for (const target of targets) kept.push(...PLATFORM_FIELDS[target]);
  } else {
    if (data.analytics_consent) kept.push(...ANALYTICS_FIELDS);
    if (data.marketing_consent) kept.push(...MARKETING_FIELDS);
    if (data.analytics_consent || data.marketing_consent) {
      kept.push(...SHARED_FIELDS);
    }
  }
  const result: DeliveryData = { ...minimal };
  for (const field of kept) {
    if (data[field] !== undefined) result[field] = data[field];
  }
  return result;
}
