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
  const apiKey =
    process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
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
  if (country) url.searchParams.set('components', `country:${country}`);

  try {
    const result = await fetchLegacyPlacesJson<LegacyAutocompleteResponse>(
      url.toString(),
      () => reserveGooglePlacesRequest('autocomplete')
    );
    if (!result.ok)
      return {
        status: result.status === 429 ? 429 : 502,
        body: {
          error: 'Failed to fetch predictions',
          code: 'PLACES_AUTOCOMPLETE_HTTP_ERROR',
        },
      };
    const data = result.data;
    if (data.status === 'ZERO_RESULTS')
      return { status: 200, body: { predictions: [] } };
    if (data.status !== 'OK')
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
