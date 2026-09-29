import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGoogleResponse,
  GET,
  makeRequest,
  mockFetch,
} from './route.test-helpers';

describe('GET /api/places/autocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('returns empty predictions when input is too short (< 2 chars)', async () => {
    const request = makeRequest({ input: 'a' });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ predictions: [] });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns empty predictions when input is empty string', async () => {
    const request = makeRequest({ input: '' });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ predictions: [] });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns predictions for valid input', async () => {
    const mockGoogleData = createGoogleResponse([
      {
        placeId: 'ChIJ1234',
        mainText: 'Lagos',
        secondaryText: 'Nigeria',
        fullText: 'Lagos, Nigeria',
      },
      {
        placeId: 'ChIJ5678',
        mainText: 'Lekki',
        secondaryText: 'Lagos, Nigeria',
        fullText: 'Lekki, Lagos, Nigeria',
      },
    ]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockGoogleData,
      text: async () => JSON.stringify(mockGoogleData),
    } as Response);

    const request = makeRequest({ input: 'Lagos' });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.predictions).toHaveLength(2);
    expect(data.predictions[0]).toEqual({
      placeId: 'ChIJ1234',
      mainText: 'Lagos',
      secondaryText: 'Nigeria',
      fullText: 'Lagos, Nigeria',
      description: 'Lagos, Nigeria',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://maps.googleapis.com/maps/api/place/autocomplete/json?input=Lagos&key=test-api-key',
      { opentelemetry: { ignore: true } }
    );
  });

  it('includes sessionToken in request body when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ suggestions: [] }),
      text: async () => '{"suggestions":[]}',
    } as Response);

    const request = makeRequest({
      input: 'test',
      sessionToken: 'session-123',
    });

    await GET(request);

    const requestedUrl = new URL(String(mockFetch.mock.calls[0]?.[0]));
    expect(requestedUrl.searchParams.get('input')).toBe('test');
    expect(requestedUrl.searchParams.get('sessiontoken')).toBe('session-123');
    expect(requestedUrl.searchParams.get('key')).toBe('test-api-key');
  });

  it('rejects an oversized session token before making an upstream request', async () => {
    const response = await GET(
      makeRequest({ input: 'Lagos', sessionToken: 's'.repeat(257) })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'Invalid sessionToken format' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('includes country restriction when country param is provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ suggestions: [] }),
      text: async () => '{"suggestions":[]}',
    } as Response);

    const request = makeRequest({
      input: 'Lagos',
      country: 'ng',
    });

    await GET(request);

    const requestedUrl = new URL(String(mockFetch.mock.calls[0]?.[0]));
    expect(requestedUrl.searchParams.get('input')).toBe('Lagos');
    expect(requestedUrl.searchParams.get('components')).toBe('country:ng');
  });

  it('filters out non-placePrediction suggestions', async () => {
    const mixedResponse = {
      status: 'OK',
      predictions: [
        {
          place_id: 'ChIJ1234',
          structured_formatting: {
            main_text: 'Valid Place',
            secondary_text: 'Nigeria',
          },
          description: 'Valid Place, Nigeria',
        },
        {
          // Missing place_id - should be filtered out.
          description: 'Missing place ID',
        },
        {
          place_id: 'ChIJ5678',
          structured_formatting: {
            main_text: 'Another Valid',
            secondary_text: 'Lagos',
          },
          description: 'Another Valid, Lagos',
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mixedResponse,
      text: async () => JSON.stringify(mixedResponse),
    } as Response);

    const request = makeRequest({ input: 'test' });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.predictions).toHaveLength(2);
    expect(data.predictions[0].placeId).toBe('ChIJ1234');
    expect(data.predictions[1].placeId).toBe('ChIJ5678');
  });

  it('handles missing structuredFormat by falling back to text.text', async () => {
    const responseWithoutStructuredFormat = {
      status: 'OK',
      predictions: [
        {
          place_id: 'ChIJ1234',
          description: 'Full Text Only',
          // No structured_formatting.
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => responseWithoutStructuredFormat,
      text: async () => JSON.stringify(responseWithoutStructuredFormat),
    } as Response);

    const request = makeRequest({ input: 'test' });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.predictions[0]).toEqual({
      placeId: 'ChIJ1234',
      mainText: 'Full Text Only',
      secondaryText: '',
      fullText: 'Full Text Only',
      description: 'Full Text Only',
    });
  });

  it('handles empty suggestions array from Google API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'ZERO_RESULTS', predictions: [] }),
      text: async () => '{"status":"ZERO_RESULTS","predictions":[]}',
    } as Response);

    const request = makeRequest({ input: 'xyz123notfound' });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.predictions).toEqual([]);
  });

  it('handles missing suggestions field in Google API response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'OK' }),
      text: async () => '{"status":"OK"}',
    } as Response);

    const request = makeRequest({ input: 'test' });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.predictions).toEqual([]);
  });
});
