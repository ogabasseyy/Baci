import { apiGet } from '@/lib/api-client';
/**
 * Google Places API Client
 * Calls server-side API routes to keep API key secure
 * Uses GET requests since these are read-only operations (no CSRF needed)
 */

export interface PlacePrediction {
  placeId: string;
  mainText: string;
  secondaryText: string;
  fullText: string;
  provider?: 'google' | 'geoapify';
  /** Geoapify includes address fields in the prediction; no Details call. */
  details?: GooglePlaceDetails;
}

export interface GooglePlaceDetails {
  placeId: string;
  formattedAddress: string;
  streetNumber?: string;
  route?: string; // Street name
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  location?: { latitude: number; longitude: number } | null;
}

/**
 * Generate a random session token
 * Recommended for billing optimization
 */
export function generateSessionToken(): string {
  return crypto.randomUUID();
}

/**
 * Get place predictions via server-side API route
 */
export async function getPlacePredictions(
  input: string,
  sessionToken?: string,
  country?: string
): Promise<PlacePrediction[]> {
  if (!input || input.length < 2) return [];

  // Errors propagate to the caller (AddressAutocomplete) so it can surface a
  // failure state — e.g. reveal a manual address fallback — instead of
  // silently rendering an empty dropdown that looks identical to "no matches".
  const params = new URLSearchParams({ input });
  // Older native clients cannot render Geoapify attribution or inline details.
  params.append('fallback', 'geoapify');
  if (sessionToken) params.append('sessionToken', sessionToken);
  if (country) params.append('country', country);

  const data = await apiGet<{ predictions?: PlacePrediction[] }>(
    `/api/places/autocomplete?${params.toString()}`
  );

  return data.predictions || [];
}

/**
 * Get place details via server-side API route
 */
export async function getPlaceDetails(
  placeId: string,
  sessionToken?: string
): Promise<GooglePlaceDetails | null> {
  if (!placeId) return null;

  try {
    const params = new URLSearchParams({ placeId });
    if (sessionToken) params.append('sessionToken', sessionToken);

    const data = await apiGet<{ details: GooglePlaceDetails }>(
      `/api/places/details?${params.toString()}`
    );

    return data.details || null;
  } catch {
    return null;
  }
}

/**
 * Get place details via server-side direct call (for SSR/Metadata)
 * This avoids calling our own API route which might fail during build.
 */
export async function getPlaceDetailsServer(placeId: string) {
  const apiKey =
    process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || !placeId) return null;

  const resourceName = placeId.startsWith('places/')
    ? placeId
    : `places/${placeId}`;
  const fields = ['reviews', 'rating', 'userRatingCount'].join(',');
  const url = `https://places.googleapis.com/v1/${resourceName}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': fields,
      },
      next: { revalidate: 3600 }, // Cache for 1 hour
      signal: AbortSignal.timeout(5000), // Timeout after 5 seconds
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to fetch place details (server):', error);
    return null;
  }
}
