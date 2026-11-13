import {
  IMEI_IDENTIFIER_BY_DEVICE,
  IMEI_SERVICE_TIERS,
  normalizeDeviceIdentifier,
  resolveInputIdentifier,
} from '@baci/shared/imei';
import type { ImeiLookupRow } from '../route-helpers';

/**
 * Normalises a re-sent identifier exactly as the IMEI route did when it
 * created the lookup (tier identifier, refined by device), so its hash can be
 * compared with the stored one. Null for a tier that no longer exists.
 */
export function normalizeForLookup(
  raw: string,
  lookup: Pick<ImeiLookupRow, 'tier' | 'device_category'>
) {
  const tier = Object.hasOwn(IMEI_SERVICE_TIERS, lookup.tier)
    ? IMEI_SERVICE_TIERS[lookup.tier]
    : undefined;
  if (!tier) return null;
  const tierIdentifier = tier.identifier;
  const identifier = lookup.device_category
    ? resolveInputIdentifier(
        tierIdentifier,
        IMEI_IDENTIFIER_BY_DEVICE[lookup.device_category]
      )
    : tierIdentifier;
  return normalizeDeviceIdentifier(raw, identifier);
}
