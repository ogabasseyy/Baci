import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  reserveGeoapifyRequest,
  reserveGooglePlacesRequest,
} from '../provider-budget';
import {
  createGoogleResponse,
  GET,
  makeRequest,
  mockFetch,
} from './route.test-helpers';

vi.mock('../provider-budget', () => ({
  reserveGooglePlacesRequest: vi.fn(async () => true),
  reserveGeoapifyRequest: vi.fn(async () => true),
}));

const geoResult = {
  place_id: 'geo-address',
  formatted: '20 Allen Avenue, Ikeja, Lagos, Nigeria',
  address_line1: '20 Allen Avenue',
  address_line2: 'Ikeja, Lagos, Nigeria',
  housenumber: '20',
  street: 'Allen Avenue',
  city: 'Ikeja',
  state: 'Lagos',
  country: 'Nigeria',
  country_code: 'ng',
  result_type: 'building',
  lat: 6.601,
  lon: 3.351,
  rank: { confidence_building_level: 1 },
};
function respond(body: unknown, status = 200) {
  return { ok: status === 200, status, json: async () => body } as Response;
}

describe('address provider fallback', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.clearAllMocks();
    vi.stubEnv('GEOAPIFY_API_KEY', 'test-geo-key');
    vi.stubEnv('GOOGLE_MAPS_API_KEY', 'test-api-key');
    vi.mocked(reserveGooglePlacesRequest).mockResolvedValue(true);
    vi.mocked(reserveGeoapifyRequest).mockResolvedValue(true);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('keeps Google first when its budget and provider succeed', async () => {
    mockFetch.mockResolvedValueOnce(
      respond(
        createGoogleResponse([
          {
            placeId: 'google-id',
            mainText: 'Lagos',
            fullText: 'Lagos, Nigeria',
          },
        ])
      )
    );
    const data = await (
      await GET(
        makeRequest({ fallback: 'geoapify', input: 'Lagos', country: 'NG' })
      )
    ).json();
    expect(data.predictions[0].placeId).toBe('google-id');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(reserveGeoapifyRequest).not.toHaveBeenCalled();
  });

  it.each([
    'OVER_QUERY_LIMIT',
    'OVER_DAILY_LIMIT',
    'REQUEST_DENIED',
    'ZERO_RESULTS',
  ])('falls back when Google returns %s', async (status) => {
    mockFetch
      .mockResolvedValueOnce(respond({ status }))
      .mockResolvedValueOnce(respond({ results: [geoResult] }));
    const response = await GET(
      makeRequest({
        fallback: 'geoapify',
        input: 'Allen Avenue',
        country: 'ng',
        sessionToken: 'session-1',
      })
    );
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.predictions[0]).toMatchObject({
      provider: 'geoapify',
      placeId: 'geoapify:geo-address',
      details: {
        city: 'Ikeja',
        state: 'Lagos',
        location: { latitude: 6.601, longitude: 3.351 },
      },
    });
    const url = new URL(String(mockFetch.mock.calls[1][0]));
    expect(url.hostname).toBe('api.geoapify.com');
    expect(url.searchParams.get('filter')).toBe('countrycode:ng');
    expect(url.searchParams.has('sessionToken')).toBe(false);
    expect(JSON.stringify(data)).not.toContain('test-geo-key');
  });

  it('does not call Google after the application monthly cap', async () => {
    vi.mocked(reserveGooglePlacesRequest).mockResolvedValue(false);
    mockFetch.mockResolvedValueOnce(respond({ results: [geoResult] }));
    const data = await (
      await GET(
        makeRequest({
          fallback: 'geoapify',
          input: 'Allen Avenue',
          country: 'ng',
        })
      )
    ).json();
    expect(data.predictions[0].provider).toBe('geoapify');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0][0])).toContain('api.geoapify.com');
  });

  it('falls back on a Google transport failure', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(respond({ results: [geoResult] }));
    expect(
      (
        await GET(
          makeRequest({
            fallback: 'geoapify',
            input: 'Allen Avenue',
            country: 'ng',
          })
        )
      ).status
    ).toBe(200);
  });

  it('exposes manual entry when both budgets are unavailable, without calling a provider', async () => {
    vi.mocked(reserveGooglePlacesRequest).mockResolvedValue(false);
    vi.mocked(reserveGeoapifyRequest).mockResolvedValue(false);
    const response = await GET(
      makeRequest({
        fallback: 'geoapify',
        input: 'Allen Avenue',
        country: 'ng',
      })
    );
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      code: 'ADDRESS_AUTOCOMPLETE_UNAVAILABLE',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    { country: 'Nigeria' },
    { input: 'a'.repeat(301) },
    { sessionToken: 's'.repeat(257) },
  ])('rejects invalid input before any provider request: %j', async (params) => {
    expect(
      (
        await GET(
          makeRequest(
            Object.fromEntries(
              Object.entries({
                fallback: 'geoapify',
                input: 'Lagos',
                ...params,
              }).filter(
                (entry): entry is [string, string] =>
                  typeof entry[1] === 'string'
              )
            )
          )
        )
      ).status
    ).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
