import {
  IMEI_IDENTIFIER_BY_DEVICE,
  IMEI_SERVICE_TIERS,
  type ImeiDeviceCategory,
  type ImeiIdentifierType,
  type ImeiServiceTierKey,
  isValidDeviceIdentifier,
  normalizeDeviceIdentifier,
  resolveInputIdentifier,
} from '@baci/shared/imei';
import { errorBody, json } from './route-helpers';

const INVALID_IDENTIFIER_MESSAGE: Record<ImeiIdentifierType, string> = {
  imei: 'Invalid IMEI number',
  serial: 'Invalid serial number',
  both: 'Invalid IMEI or serial number',
};

export function resolveImeiIdentifier(
  imei: string,
  tier: ImeiServiceTierKey,
  device?: ImeiDeviceCategory
) {
  const tierIdentifier = IMEI_SERVICE_TIERS[tier].identifier;
  const identifier = device
    ? resolveInputIdentifier(tierIdentifier, IMEI_IDENTIFIER_BY_DEVICE[device])
    : tierIdentifier;
  // Validate the raw value before normalization, which can truncate it.
  if (!isValidDeviceIdentifier(imei, identifier)) {
    return {
      response: json(
        errorBody({
          code: 'INVALID_IMEI',
          error: INVALID_IDENTIFIER_MESSAGE[identifier],
        }),
        400
      ),
      normalized: null,
    };
  }
  return {
    response: null,
    normalized: normalizeDeviceIdentifier(imei, identifier),
  };
}
