import { resolveLocationStateLabel } from '@baci/shared/lib';
import {
  NIGERIAN_CITIES_FALLBACK,
  NIGERIAN_STATES_FALLBACK,
} from '@/app/api/shipping/locations/fallback-locations';
import { deriveMerchantLocation } from '@/lib/shipping/merchant-location';
import {
  REPAIR_PICKUP_COUNTRY_SEGMENTS,
  REPAIR_PICKUP_LOCATION_ALIASES,
  REPAIR_PICKUP_STATE_DISPLAY_LABELS,
} from './repair-pickup-location-constants';

function normalizeLocation(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\bstate\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function normalizedLocationAlias(value: string): string {
  const normalized = normalizeLocation(value);
  return REPAIR_PICKUP_LOCATION_ALIASES[normalized] ?? normalized;
}

function displayState(state: string): string {
  return REPAIR_PICKUP_STATE_DISPLAY_LABELS[state] ?? state;
}

function withoutPostalCode(value: string): string {
  return value.replace(/\b\d{5,6}\b/g, '').trim();
}

function canonicalState(value: string): string | null {
  const resolved = resolveLocationStateLabel(value, NIGERIAN_STATES_FALLBACK);
  return NIGERIAN_STATES_FALLBACK.includes(resolved) ? resolved : null;
}

function stateForCity(value: string): string | null {
  const normalized = normalizedLocationAlias(value);
  for (const [state, cities] of Object.entries(NIGERIAN_CITIES_FALLBACK)) {
    if (cities.some((city) => normalizedLocationAlias(city) === normalized)) {
      return displayState(state);
    }
  }
  return null;
}

export function resolveRepairPickupLocation(address: string): {
  address: string;
  city: string;
  state: string;
} {
  const fallback = deriveMerchantLocation(address);
  const parts = address
    .split(',')
    .map((part) => withoutPostalCode(part))
    .filter(
      (part) =>
        part.length > 0 &&
        !REPAIR_PICKUP_COUNTRY_SEGMENTS.has(normalizeLocation(part))
    );

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const state = canonicalState(parts[index]);
    if (state) {
      const preceding = parts[index - 1];
      const city =
        preceding && stateForCity(preceding) ? preceding : displayState(state);
      return {
        address: fallback.address,
        city,
        state: displayState(state),
      };
    }
  }

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const state = stateForCity(parts[index]);
    if (state) {
      return {
        address: fallback.address,
        city: parts[index],
        state,
      };
    }
  }

  return fallback;
}
