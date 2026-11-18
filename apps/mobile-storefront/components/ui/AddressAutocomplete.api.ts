import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { resolveApiBaseUrl } from '@/lib/api-url';
import { createLogger } from '@/lib/logger';
import type {
  PlaceDetails,
  PlacePrediction,
} from './AddressAutocomplete.types';

const API_BASE_URL = resolveApiBaseUrl(
  process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl
);
// Places failures are handled (no suggestions, manual entry still works), so
// they log at info level. console.error/warn would raise a React Native LogBox
// bar on every keystroke while the address is typed.
const log = createLogger('AddressAutocomplete');
const PREDICTION_CACHE_MAX_SIZE = 50;
const predictionCache = new Map<string, PlacePrediction[]>();

export function generateSessionToken(): string {
  return Crypto.randomUUID();
}

export function clearPredictionCache() {
  predictionCache.clear();
}

function setCacheEntry(key: string, value: PlacePrediction[]): void {
  if (predictionCache.size >= PREDICTION_CACHE_MAX_SIZE) {
    const firstKey = predictionCache.keys().next().value;
    if (firstKey !== undefined) {
      predictionCache.delete(firstKey);
    }
  }
  predictionCache.set(key, value);
}

function getPredictionCacheKey(input: string, country?: string): string {
  return `${input.trim().toLowerCase()}|${country?.trim().toUpperCase() ?? ''}`;
}

function toPredictionResponse(value: unknown): {
  predictions?: PlacePrediction[];
} {
  return value && typeof value === 'object'
    ? (value as { predictions?: PlacePrediction[] })
    : {};
}

export async function fetchAddressPredictions({
  country,
  input,
  sessionToken,
}: {
  country?: string;
  input: string;
  sessionToken: string;
}): Promise<PlacePrediction[]> {
  if (input.length < 2) {
    return [];
  }

  const cacheKey = getPredictionCacheKey(input, country);
  const cachedPredictions = predictionCache.get(cacheKey);
  if (cachedPredictions) {
    return cachedPredictions;
  }

  try {
    const params = new URLSearchParams({
      input,
      sessionToken,
      ...(country && { country }),
    });
    const response = await fetch(
      `${API_BASE_URL}/api/places/autocomplete?${params}`
    );

    if (!response.ok) {
      const errorText = await response.text();
      log.info(`Autocomplete HTTP ${response.status}: ${errorText}`);
      if (response.status === 403) {
        throw new Error('Google Places API requires billing to be enabled.');
      }
      throw new Error('Failed to fetch predictions');
    }

    const data = toPredictionResponse(await response.json());
    const results = data.predictions || [];
    setCacheEntry(cacheKey, results);
    return results;
  } catch (error) {
    log.info('Address predictions unavailable', error);
    return [];
  }
}

export async function fetchPlaceDetails({
  prediction,
  sessionToken,
}: {
  prediction: PlacePrediction;
  sessionToken: string;
}): Promise<PlaceDetails | null> {
  try {
    const params = new URLSearchParams({
      placeId: prediction.placeId,
      sessionToken,
    });
    const response = await fetch(
      `${API_BASE_URL}/api/places/details?${params}`
    );

    if (!response.ok) {
      const errorText = await response.text();
      log.info(`Place details HTTP ${response.status}: ${errorText}`);
      throw new Error('Failed to fetch place details');
    }

    const data = await response.json();
    const details = data.details;
    if (!details) {
      return null;
    }

    return {
      streetNumber: details.streetNumber || '',
      route: details.route || '',
      city: details.city || '',
      state: details.state || '',
      zip: details.postalCode || '',
      country: details.country || '',
      formattedAddress: details.formattedAddress || prediction.description,
      latitude:
        typeof details.location?.latitude === 'number'
          ? details.location.latitude
          : undefined,
      longitude:
        typeof details.location?.longitude === 'number'
          ? details.location.longitude
          : undefined,
    };
  } catch (error) {
    log.info('Place details unavailable', error);
    return null;
  }
}
