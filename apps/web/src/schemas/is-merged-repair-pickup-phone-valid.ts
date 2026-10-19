import { isValidPhone } from '@baci/shared/lib';
import { hasMinimumPhoneDigits } from '@/lib/phone';

/**
 * Post-merge guard for repair-center PATCH. Schema alone cannot see persisted
 * pickup_enabled, so the route merges first and then requires a usable phone
 * whenever the effective settings keep courier pickup enabled.
 *
 * Omitted pickup_enabled matches get_repair_pickup_receiver: treat as enabled
 * (COALESCE(pickup_enabled, 'true') IS DISTINCT FROM 'false').
 */
export function isMergedRepairPickupPhoneValid(settings: {
  pickup_enabled?: unknown;
  contact_phone?: unknown;
}): boolean {
  if (settings.pickup_enabled === false) {
    return true;
  }

  return (
    typeof settings.contact_phone === 'string' &&
    hasMinimumPhoneDigits(settings.contact_phone) &&
    isValidPhone(settings.contact_phone)
  );
}
