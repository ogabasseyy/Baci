import { isConversionEvent } from '@/lib/analytics/is-conversion-event';

/**
 * Shopper fields that exist only so an ad platform can match a conversion.
 * Everything here is personal data; none of it may be stored unless a
 * destination can actually use it.
 */
const PERSONAL_DELIVERY_FIELDS = [
  'email',
  'external_id',
  'fbc',
  'fbp',
  'ip',
  'phone',
  'sccid',
  'ttclid',
  'ttp',
  'ua',
] as const;

type PersonalDeliveryField = (typeof PERSONAL_DELIVERY_FIELDS)[number];

export type DeliveryData = {
  analytics_consent: boolean;
  marketing_consent: boolean;
} & Partial<Record<PersonalDeliveryField, string | undefined>>;

/**
 * Data minimisation at ingest: keep the shopper's personal matching fields
 * only when the event can fan out to an ad platform (a conversion-class event)
 * AND the visitor granted at least one consent. Otherwise only the two consent
 * flags are kept, so the ledger and delivery rows never hold the personal data.
 */
export function minimizeDeliveryData(
  data: DeliveryData,
  eventType: string
): DeliveryData {
  const canBeUsed =
    isConversionEvent(eventType) &&
    (data.analytics_consent || data.marketing_consent);
  if (canBeUsed) return data;
  return {
    analytics_consent: data.analytics_consent,
    marketing_consent: data.marketing_consent,
  };
}
