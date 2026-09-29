import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('GOOGLE_MAPS_API_KEY', 'test-api-key');

const mockFetch = vi.fn();
global.fetch = mockFetch;

const { GET } = await import('./route');

function makeRequest(params: Record<string, string>) {
  const url = new URL('http://localhost:3000/api/places/details');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url);
}

describe('GET /api/places/details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not crash when an address component is missing types', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'OK',
        result: {
          place_id: 'ChIJ1234',
          formatted_address: '2 Olaide Tomori St, Ikeja, Lagos, Nigeria',
          address_components: [
            { long_name: 'ignored-without-types' },
            { types: ['locality'], long_name: 'Ikeja' },
            { types: ['country'], long_name: 'Nigeria' },
          ],
          geometry: { location: { lat: 6.6, lng: 3.3 } },
        },
      }),
    } as Response);

    const response = await GET(makeRequest({ placeId: 'places/ChIJ1234' }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      details: expect.objectContaining({
        placeId: 'places/ChIJ1234',
        city: 'Ikeja',
        country: 'Nigeria',
        streetNumber: '',
        location: { latitude: 6.6, longitude: 3.3 },
      }),
    });
  });

  it('passes the autocomplete session token through to Place Details', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'OK',
        result: {
          place_id: 'ChIJ1234',
          formatted_address: 'Lagos, Nigeria',
          address_components: [],
        },
      }),
    } as Response);

    const response = await GET(
      makeRequest({ placeId: 'ChIJ1234', sessionToken: 'session-123' })
    );

    expect(response.status).toBe(200);
    const requestUrl = new URL(String(mockFetch.mock.calls[0]?.[0]));
    expect(requestUrl.origin + requestUrl.pathname).toBe(
      'https://maps.googleapis.com/maps/api/place/details/json'
    );
    expect(requestUrl.searchParams.get('place_id')).toBe('ChIJ1234');
    expect(requestUrl.searchParams.get('fields')).toBe(
      'address_components,formatted_address,geometry'
    );
    expect(requestUrl.searchParams.get('sessiontoken')).toBe('session-123');
    expect(requestUrl.searchParams.get('key')).toBe('test-api-key');
    expect(mockFetch).toHaveBeenCalledWith(expect.any(String), {
      opentelemetry: { ignore: true },
    });
  });

  it('returns 400 for malformed placeId', async () => {
    const response = await GET(makeRequest({ placeId: 'a'.repeat(4001) }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'Invalid placeId format' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects an oversized session token before making an upstream request', async () => {
    const response = await GET(
      makeRequest({ placeId: 'ChIJ1234', sessionToken: 's'.repeat(257) })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'Invalid sessionToken format' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('accepts opaque place IDs and lets URLSearchParams encode them', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'OK',
        result: { place_id: 'EicxMy1+place.id', address_components: [] },
      }),
    } as Response);

    const response = await GET(
      makeRequest({ placeId: 'EicxMy1+place.id', sessionToken: 'session-123' })
    );

    expect(response.status).toBe(200);
    const requestUrl = new URL(String(mockFetch.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get('place_id')).toBe('EicxMy1+place.id');
  });

  it('returns a safe 429 response when Legacy Place Details reports a quota limit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'OVER_QUERY_LIMIT',
        error_message: 'Provider detail that must not reach the client',
      }),
    } as Response);

    const response = await GET(makeRequest({ placeId: 'ChIJ1234' }));
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data).toEqual({
      error: 'Failed to fetch place details',
      code: 'PLACES_DETAILS_UPSTREAM_ERROR',
    });
  });

  it('maps a non-quota HTTP error from Legacy Place Details to 502', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
    } as Response);

    const response = await GET(makeRequest({ placeId: 'ChIJ1234' }));
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data).toEqual({
      error: 'Failed to fetch place details',
      code: 'PLACES_DETAILS_HTTP_ERROR',
    });
  });

  it('preserves 429 for an HTTP-level upstream quota response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
    } as Response);

    const response = await GET(makeRequest({ placeId: 'ChIJ1234' }));
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data).toEqual({
      error: 'Failed to fetch place details',
      code: 'PLACES_DETAILS_HTTP_ERROR',
    });
  });

  it('returns 404 when Legacy Place Details has no result for the place ID', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'ZERO_RESULTS',
      }),
    } as Response);

    const response = await GET(makeRequest({ placeId: 'ChIJ1234' }));
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({
      error: 'Failed to fetch place details',
      code: 'PLACES_DETAILS_UPSTREAM_ERROR',
    });
  });
});
