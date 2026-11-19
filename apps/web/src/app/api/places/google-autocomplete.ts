import {
  fetchLegacyPlacesJson,
  isRetryableNetworkError,
} from './legacy-places';
import { reserveGooglePlacesRequest } from './provider-budget';

interface LegacyAutocompleteResponse {
  status?: string;
  predictions?: {
    description?: string;
    place_id?: string;
    structured_formatting?: { main_text?: string; secondary_text?: string };
  }[];
}

export async function fetchGoogleAutocomplete(
  input: string,
  sessionToken?: string,
  country?: string
) {
  // Trim like env.ts: a whitespace-only key must take the NOT_CONFIGURED
  // path (which permits Geoapify fallback), not spend budget upstream.
  const apiKey =
    process.env.GOOGLE_PLACES_API_KEY?.trim() ||
    process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey)
    return {
      status: 500,
      body: {
        error: 'Google Places API not configured',
        code: 'PLACES_AUTOCOMPLETE_NOT_CONFIGURED',
      },
    };

  const url = new URL(
    'https://maps.googleapis.com/maps/api/place/autocomplete/json'
  );
  url.searchParams.set('input', input);
  url.searchParams.set('key', apiKey);
  if (sessionToken) url.searchParams.set('sessiontoken', sessionToken);
  if (country)
    url.searchParams.set('components', `country:${country.toLowerCase()}`);

  try {
    const result = await fetchLegacyPlacesJson<LegacyAutocompleteResponse>(
      url.toString(),
      () => reserveGooglePlacesRequest('autocomplete'),
      // One 5s stall then fall back to Geoapify: retrying timeouts here
      // would delay suggestions ~16.5s during the stalls fallback covers.
      { retryTimeouts: false }
    );
    if (!result.ok) {
      if (result.failure === 'budget_limit_reached') {
        console.warn('[Address API] Google autocomplete budget limit reached');
        return {
          status: 429,
          body: {
            error: 'Address suggestions are temporarily limited',
            code: 'PLACES_AUTOCOMPLETE_BUDGET_LIMIT_REACHED',
          },
        };
      }
      if (result.failure === 'budget_unavailable') {
        console.warn('[Address API] Google autocomplete budget unavailable');
        return {
          status: 503,
          body: {
            error: 'Address suggestions are temporarily unavailable',
            code: 'PLACES_AUTOCOMPLETE_BUDGET_UNAVAILABLE',
          },
        };
      }
      console.error('[Places API] Autocomplete HTTP error:', result.status);
      return {
        status: result.status === 429 ? 429 : 502,
        body: {
          error: 'Failed to fetch predictions',
          code: 'PLACES_AUTOCOMPLETE_HTTP_ERROR',
        },
      };
    }
    const data = result.data;
    if (data.status === 'ZERO_RESULTS')
      return { status: 200, body: { predictions: [] } };
    if (data.status !== 'OK') {
      // Status only, never the key or error_message body: a silent
      // REQUEST_DENIED would otherwise mask a key misconfiguration
      // behind Geoapify fallback with no server-side signal.
      console.error('[Places API] Autocomplete returned:', data.status);
      return {
        status:
          data.status === 'INVALID_REQUEST'
            ? 400
            : data.status === 'OVER_QUERY_LIMIT' ||
                data.status === 'OVER_DAILY_LIMIT'
              ? 429
              : 502,
        body: {
          error: 'Failed to fetch predictions',
          code: 'PLACES_AUTOCOMPLETE_UPSTREAM_ERROR',
        },
      };
    }
    const predictions = (data.predictions || [])
      .filter(
        (prediction) =>
          typeof prediction.place_id === 'string' &&
          prediction.place_id.length > 0
      )
      .map((prediction) => {
        const description = prediction.description || '';
        return {
          placeId: prediction.place_id,
          mainText: prediction.structured_formatting?.main_text || description,
          secondaryText: prediction.structured_formatting?.secondary_text || '',
          fullText: description,
          description,
        };
      });
    return { status: 200, body: { predictions } };
  } catch (error) {
    if (isRetryableNetworkError(error))
      return {
        status: 502,
        body: {
          error: 'Failed to fetch predictions',
          code: 'PLACES_AUTOCOMPLETE_HTTP_ERROR',
        },
      };
    return { status: 500, body: { error: 'Internal server error' } };
  }
}
