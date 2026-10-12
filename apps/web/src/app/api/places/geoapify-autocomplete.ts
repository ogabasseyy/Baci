import 'server-only';

import type { PlacePrediction } from '@/lib/google-places';
import {
  geoapifyAutocompleteResponseSchema,
  geoapifyAutocompleteResultSchema,
} from '@/schemas/geoapify-autocomplete-response';
import { reserveGeoapifyRequest } from './provider-budget';

export class GeoapifyAutocompleteError extends Error {
  constructor(public readonly status: number) {
    super('Address suggestions are temporarily unavailable');
  }
}

export async function fetchGeoapifyPredictions(
  input: string,
  country?: string
): Promise<PlacePrediction[]> {
  const apiKey = process.env.GEOAPIFY_API_KEY?.trim();
  if (!apiKey) throw new GeoapifyAutocompleteError(503);
  if (!(await reserveGeoapifyRequest()))
    throw new GeoapifyAutocompleteError(429);

  // Geoapify documents lowercase countrycode filters; normalize once so
  // direct callers cannot desync the request filter from the match check.
  const normalizedCountry = country?.toLowerCase();
  const url = new URL('https://api.geoapify.com/v1/geocode/autocomplete');
  url.searchParams.set('text', input);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '5');
  url.searchParams.set('apiKey', apiKey);
  if (normalizedCountry)
    url.searchParams.set('filter', `countrycode:${normalizedCountry}`);

  try {
    const response = await fetch(url.toString(), {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
      // The credential-bearing URL must not enter exported fetch spans.
      opentelemetry: { ignore: true },
    });
    if (!response.ok)
      throw new GeoapifyAutocompleteError(response.status === 429 ? 429 : 502);
    const data = geoapifyAutocompleteResponseSchema.parse(
      await response.json()
    );
    const results = data.results.flatMap((result) => {
      const parsed = geoapifyAutocompleteResultSchema.safeParse(result);
      return parsed.success ? [parsed.data] : [];
    });
    return results
      .filter(
        // The request already restricts country; reject only conflicting metadata.
        (result) =>
          !normalizedCountry ||
          !result.country_code ||
          result.country_code.toLowerCase() === normalizedCountry
      )
      .map((result) => {
        const placeId = `geoapify:${result.place_id}`;
        const specificMatch =
          (result.result_type === 'street' &&
            (result.rank?.confidence_street_level ?? 0) >= 0.9) ||
          ((result.result_type === 'building' ||
            result.result_type === 'amenity') &&
            (result.rank?.confidence_building_level ?? 0) >= 0.9);
        return {
          placeId,
          provider: 'geoapify' as const,
          mainText: result.address_line1 || result.formatted,
          secondaryText: result.address_line2 || '',
          fullText: result.formatted,
          details: {
            placeId,
            formattedAddress: result.formatted,
            streetNumber: result.housenumber || '',
            route: result.street || '',
            city:
              result.city ||
              result.town ||
              result.village ||
              result.county ||
              '',
            state: result.state || '',
            country: result.country || '',
            postalCode: result.postcode || '',
            // A city centroid or guessed house number is not a delivery location.
            location:
              specificMatch &&
              result.lat !== undefined &&
              result.lon !== undefined
                ? { latitude: result.lat, longitude: result.lon }
                : null,
          },
        };
      });
  } catch (error) {
    if (error instanceof GeoapifyAutocompleteError) throw error;
    throw new GeoapifyAutocompleteError(502);
  }
}
