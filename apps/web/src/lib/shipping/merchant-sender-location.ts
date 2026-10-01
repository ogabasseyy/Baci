import type { RegisteredAddress } from '@baci/shared';
import { NIGERIAN_CITIES_FALLBACK } from '@/app/api/shipping/locations/fallback-locations';
import { deriveMerchantLocation } from './merchant-location';
import {
  getSubdivisions,
  resolveSubdivisionCode,
} from './merchant-rates/subdivisions';
import type { ShippingAddress } from './types';

type MerchantSenderDetails = {
  businessAddress: string | null;
  businessName: string | null;
  phone: string | null;
  registeredAddress: unknown;
  stateCode: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(
  record: Record<string, unknown>,
  key: string
): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readPostalCode(record: Record<string, unknown>): string | null {
  const value = record.postal_code ?? record.postalCode;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseRegisteredAddress(value: unknown): RegisteredAddress | null {
  if (!isRecord(value)) return null;

  const address: RegisteredAddress = {
    city: readString(value, 'city'),
    country: readString(value, 'country'),
    postal_code: readPostalCode(value),
    state: readString(value, 'state'),
    street: readString(value, 'street'),
  };

  return Object.values(address).some(Boolean) ? address : null;
}

function hasLetters(value: string | null | undefined): value is string {
  return Boolean(value?.trim() && /[a-z]/i.test(value));
}

function normalizeCityToken(value: string): string {
  return value.trim().toLowerCase();
}

function resolveStateFromCode(stateCode: string | null): string | null {
  const normalized = stateCode?.trim().toUpperCase();
  if (!normalized) return null;

  const subdivisionCode = normalized.startsWith('NG-')
    ? normalized
    : normalized.length === 2
      ? `NG-${normalized}`
      : resolveSubdivisionCode('NG', normalized);
  if (!subdivisionCode) return null;

  const subdivision = getSubdivisions('NG').find(
    (candidate) => candidate.code === subdivisionCode
  );
  return subdivision?.name.replace(/\s+\(FCT\)$/i, '') ?? null;
}

function resolveStateFromLabel(
  stateLabel: string | null | undefined
): string | null {
  if (!stateLabel?.trim()) return null;

  const subdivisionCode = resolveSubdivisionCode('NG', stateLabel);
  if (!subdivisionCode) return null;

  const subdivision = getSubdivisions('NG').find(
    (candidate) => candidate.code === subdivisionCode
  );
  return subdivision?.name.replace(/\s+\(FCT\)$/i, '') ?? null;
}

function inferStateFromNigerianCity(
  city: string | null | undefined
): string | null {
  if (!city?.trim()) return null;

  const normalizedCity = normalizeCityToken(city);
  for (const [stateLabel, cities] of Object.entries(NIGERIAN_CITIES_FALLBACK)) {
    if (
      cities.some(
        (candidate) => normalizeCityToken(candidate) === normalizedCity
      )
    ) {
      return resolveStateFromLabel(stateLabel);
    }
  }

  return resolveStateFromLabel(city);
}

function formatRegisteredAddress(address: RegisteredAddress): string {
  return [address.street, address.city, address.state, address.postal_code]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(', ');
}

function readBusinessPostalCode(
  address: string | undefined
): string | undefined {
  return address?.match(/\b\d{6}\b/g)?.at(-1);
}

const STATE_LEVEL_CITY_ALIASES = new Set(['lagos', 'abuja', 'fct']);

function resolveMerchantCity({
  registeredAddress,
  locationCity,
}: {
  registeredAddress: RegisteredAddress | null;
  locationCity: string;
}): string {
  const structuredCity = registeredAddress?.city?.trim();
  if (!structuredCity) return locationCity;

  const hasStructuredState = hasLetters(registeredAddress?.state);
  if (
    !hasStructuredState &&
    STATE_LEVEL_CITY_ALIASES.has(normalizeCityToken(structuredCity))
  ) {
    return locationCity;
  }

  return structuredCity;
}

function resolveMerchantState({
  registeredAddress,
  stateCode,
  locationCity,
  locationState,
}: {
  registeredAddress: RegisteredAddress | null;
  stateCode: string | null;
  locationCity: string;
  locationState: string;
}): string {
  const structuredState = hasLetters(registeredAddress?.state)
    ? registeredAddress.state
    : null;
  // Canonicalize labels like "Abuja (FCT)" before returning — raw values make
  // GIGL normalize to abujafct while stations use abuja, so quotes fail.
  if (structuredState) {
    return resolveStateFromLabel(structuredState) ?? structuredState;
  }

  // Prefer a recognized state from business_address before state_code — the
  // public guest path cannot select registered_address, and state_code can be
  // stale (e.g. FC) while business_address still ends in Lagos.
  const recognizedLocationState = resolveStateFromLabel(locationState);
  if (recognizedLocationState) return recognizedLocationState;
  const stateFromCode = resolveStateFromCode(stateCode);
  if (stateFromCode) return stateFromCode;

  const city = registeredAddress?.city || locationCity;
  return inferStateFromNigerianCity(city) ?? '';
}

export function buildMerchantSenderInfo(
  details: MerchantSenderDetails
): ShippingAddress | null {
  const registeredAddress = parseRegisteredAddress(details.registeredAddress);
  const businessAddress = details.businessAddress?.trim();
  const selectedRegisteredAddress = businessAddress ? null : registeredAddress;
  const addressValue =
    businessAddress ||
    (selectedRegisteredAddress
      ? formatRegisteredAddress(selectedRegisteredAddress)
      : '');
  // Fail closed: do not fabricate a Lagos origin when the merchant has no
  // usable business_address / registered_address (state_code alone is not enough).
  if (!addressValue) {
    return null;
  }
  const location = deriveMerchantLocation(addressValue);
  const state = resolveMerchantState({
    registeredAddress: selectedRegisteredAddress,
    stateCode: details.stateCode,
    locationCity: location.city,
    locationState: location.state,
  });

  return {
    name: details.businessName || 'Merchant',
    phone: details.phone || '',
    address: location.address,
    city: resolveMerchantCity({
      registeredAddress: selectedRegisteredAddress,
      locationCity: location.city,
    }),
    state,
    country: 'Nigeria',
    countryCode: 'NG',
    postalCode:
      selectedRegisteredAddress?.postal_code ??
      readBusinessPostalCode(businessAddress),
  };
}
