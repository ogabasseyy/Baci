/**
 * Google Places Autocomplete (Legacy) API route.
 * Proxies requests server-side so the Google API key stays private.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { fetchLegacyPlacesJson } from '../legacy-places';

const GOOGLE_API_KEY =
  process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const LEGACY_PLACES_AUTOCOMPLETE_URL =
  'https://maps.googleapis.com/maps/api/place/autocomplete/json';
const MAX_SESSION_TOKEN_LENGTH = 256;

interface LegacyAutocompletePrediction {
  description?: string;
  place_id?: string;
  structured_formatting?: {
    main_text?: string;
    secondary_text?: string;
  };
}

interface LegacyAutocompleteResponse {
  error_message?: string;
  predictions?: LegacyAutocompletePrediction[];
  status?: string;
}

function getUpstreamStatusCode(status: string): number {
  switch (status) {
    case 'INVALID_REQUEST':
      return 400;
    case 'OVER_QUERY_LIMIT':
    case 'OVER_DAILY_LIMIT':
      return 429;
    default:
      return 502;
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
    const input = searchParams.get('input') || '';
    const sessionToken = searchParams.get('sessionToken') || undefined;
    const country = searchParams.get('country') || undefined;

    if (sessionToken && sessionToken.length > MAX_SESSION_TOKEN_LENGTH) {
      return NextResponse.json(
        { error: 'Invalid sessionToken format' },
        { status: 400 }
      );
    }

    if (!input || input.length < 2) {
      return NextResponse.json({ predictions: [] });
    }

    const autocompleteUrl = new URL(LEGACY_PLACES_AUTOCOMPLETE_URL);
    autocompleteUrl.searchParams.set('input', input);
    autocompleteUrl.searchParams.set('key', GOOGLE_API_KEY);

    if (sessionToken) {
      autocompleteUrl.searchParams.set('sessiontoken', sessionToken);
    }

    if (country) {
      autocompleteUrl.searchParams.set(
        'components',
        `country:${country.toLowerCase()}`
      );
    }

    const result = await fetchLegacyPlacesJson<LegacyAutocompleteResponse>(
      autocompleteUrl.toString()
    );

    if (!result.ok) {
      console.error('[Places API] Autocomplete HTTP error:', result.status);
      return NextResponse.json(
        {
          error: 'Failed to fetch predictions',
          code: 'PLACES_AUTOCOMPLETE_HTTP_ERROR',
        },
        { status: result.status === 429 ? 429 : 502 }
      );
    }

    const data = result.data;

    if (data.status === 'ZERO_RESULTS') {
      return NextResponse.json({ predictions: [] });
    }

    if (data.status !== 'OK') {
      const upstreamStatus = data.status || 'UNKNOWN_ERROR';
      console.error('[Places API] Autocomplete returned:', upstreamStatus);
      return NextResponse.json(
        {
          error: 'Failed to fetch predictions',
          code: 'PLACES_AUTOCOMPLETE_UPSTREAM_ERROR',
        },
        { status: getUpstreamStatusCode(upstreamStatus) }
      );
    }

    const predictions = (data.predictions || [])
      .filter(
        (prediction) =>
          typeof prediction.place_id === 'string' &&
          prediction.place_id.length > 0
      )
      .map((prediction) => {
        const description = prediction.description || '';
        const mainText =
          prediction.structured_formatting?.main_text || description;

        return {
          placeId: prediction.place_id,
          mainText,
          secondaryText: prediction.structured_formatting?.secondary_text || '',
          fullText: description,
          description,
        };
      });

    return NextResponse.json({ predictions });
  } catch {
    console.error('[Places API] Autocomplete request failed');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
