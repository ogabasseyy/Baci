/**
 * Google Place Details (Legacy) API route.
 * Proxies address-only requests server-side so the Google API key stays private.
 */

import { type NextRequest, NextResponse } from 'next/server';

const GOOGLE_API_KEY =
  process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const LEGACY_PLACES_DETAILS_URL =
  'https://maps.googleapis.com/maps/api/place/details/json';
const MAX_SESSION_TOKEN_LENGTH = 256;
const ADDRESS_FIELDS = [
  'address_components',
  'formatted_address',
  'geometry',
].join(',');

interface LegacyAddressComponent {
  long_name?: string;
  types?: string[];
}

interface LegacyPlaceResult {
  address_components?: LegacyAddressComponent[];
  formatted_address?: string;
  geometry?: {
    location?: {
      lat?: number;
      lng?: number;
    } | null;
  } | null;
  place_id?: string;
}

interface LegacyPlaceDetailsResponse {
  error_message?: string;
  result?: LegacyPlaceResult;
  status?: string;
}

function getUpstreamStatusCode(status: string): number {
  switch (status) {
    case 'INVALID_REQUEST':
      return 400;
    case 'NOT_FOUND':
    case 'ZERO_RESULTS':
      return 404;
    case 'OVER_QUERY_LIMIT':
    case 'OVER_DAILY_LIMIT':
      return 429;
    default:
      return 502;
  }
}

async function fetchWithRetry(
  url: string,
  retries = 2,
  delay = 500
): Promise<Response> {
  try {
    return await fetch(url, {
      // Legacy Places requires the API key in the query string. Keep the
      // credential-bearing URL out of exported fetch spans.
      opentelemetry: { ignore: true },
    });
  } catch (error: unknown) {
    const isRetryable =
      error instanceof Error &&
      (error.message.includes('ECONNRESET') ||
        error.message.includes('fetch failed') ||
        error.message.includes('socket'));

    if (isRetryable && retries > 0) {
      console.warn(`[Places API] Fetch failed, retrying... (${retries} left)`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchWithRetry(url, retries - 1, delay * 2);
    }
    throw error;
  }
}

export async function GET(request: NextRequest) {
  try {
    if (!GOOGLE_API_KEY) {
      console.error(
        '[Places API] GOOGLE_MAPS_API_KEY or GOOGLE_PLACES_API_KEY not configured'
      );
      return NextResponse.json(
        { error: 'Google Places API not configured' },
        { status: 500 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const placeId = searchParams.get('placeId');
    const sessionToken = searchParams.get('sessionToken');

    if (sessionToken && sessionToken.length > MAX_SESSION_TOKEN_LENGTH) {
      return NextResponse.json(
        { error: 'Invalid sessionToken format' },
        { status: 400 }
      );
    }

    if (!placeId) {
      return NextResponse.json(
        { error: 'placeId is required' },
        { status: 400 }
      );
    }

    const cleanPlaceId = placeId.startsWith('places/')
      ? placeId.slice('places/'.length)
      : placeId;

    // Place IDs are opaque and can be longer or contain characters outside a
    // narrow alphanumeric pattern. URLSearchParams safely encodes them for this
    // fixed endpoint; reject empty or oversized inputs.
    if (cleanPlaceId.length === 0 || cleanPlaceId.length > 4000) {
      return NextResponse.json(
        { error: 'Invalid placeId format' },
        { status: 400 }
      );
    }

    const detailsUrl = new URL(LEGACY_PLACES_DETAILS_URL);
    detailsUrl.searchParams.set('place_id', cleanPlaceId);
    detailsUrl.searchParams.set('fields', ADDRESS_FIELDS);
    detailsUrl.searchParams.set('key', GOOGLE_API_KEY);

    if (sessionToken) {
      detailsUrl.searchParams.set('sessiontoken', sessionToken);
    }

    const response = await fetchWithRetry(detailsUrl.toString());

    if (!response.ok) {
      console.error('[Places API] Details HTTP error:', response.status);
      return NextResponse.json(
        {
          error: 'Failed to fetch place details',
          code: 'PLACES_DETAILS_HTTP_ERROR',
        },
        { status: response.status === 429 ? 429 : 502 }
      );
    }

    const data = (await response.json()) as LegacyPlaceDetailsResponse;
    if (data.status !== 'OK' || !data.result) {
      const upstreamStatus = data.status || 'UNKNOWN_ERROR';
      console.error('[Places API] Details returned:', upstreamStatus);
      return NextResponse.json(
        {
          error: 'Failed to fetch place details',
          code: 'PLACES_DETAILS_UPSTREAM_ERROR',
        },
        { status: getUpstreamStatusCode(upstreamStatus) }
      );
    }

    const result = data.result;
    const components = Array.isArray(result.address_components)
      ? result.address_components
      : [];
    const getComponent = (type: string) =>
      components.find((component) => component.types?.includes(type))
        ?.long_name || '';

    const coordinates = result.geometry?.location;
    const location =
      typeof coordinates?.lat === 'number' &&
      typeof coordinates.lng === 'number'
        ? { latitude: coordinates.lat, longitude: coordinates.lng }
        : null;

    const details = {
      placeId: `places/${result.place_id || cleanPlaceId}`,
      formattedAddress: result.formatted_address || '',
      streetNumber: getComponent('street_number'),
      route: getComponent('route'),
      city:
        getComponent('locality') || getComponent('administrative_area_level_2'),
      state: getComponent('administrative_area_level_1'),
      country: getComponent('country'),
      postalCode: getComponent('postal_code'),
      location,
    };

    return NextResponse.json({ details });
  } catch {
    console.error('[Places API] Details request failed');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
