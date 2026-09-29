import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGoogleResponse,
  GET,
  makeRequest,
  mockFetch,
} from './route.test-helpers';

describe('GET /api/places/autocomplete errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('returns error status when Google API returns non-ok response', async () => {
    const errorText = 'Invalid API key';

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => errorText,
    } as Response);

    const request = makeRequest({ input: 'Lagos' });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data).toEqual({
      error: 'Failed to fetch predictions',
      code: 'PLACES_AUTOCOMPLETE_HTTP_ERROR',
    });
  });

  it('returns error when Google API returns 400 bad request', async () => {
    const errorText = 'Bad request: invalid input';

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => errorText,
    } as Response);

    const request = makeRequest({ input: 'test123' });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data).toEqual({
      error: 'Failed to fetch predictions',
      code: 'PLACES_AUTOCOMPLETE_HTTP_ERROR',
    });
  });

  it('returns 500 on network/fetch error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const request = makeRequest({ input: 'Lagos' });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ error: 'Internal server error' });
  });

  it('retries on ECONNRESET error and eventually returns 500', async () => {
    const econnResetError = new Error('fetch failed: ECONNRESET');

    // Will retry twice (total 3 attempts)
    mockFetch
      .mockRejectedValueOnce(econnResetError)
      .mockRejectedValueOnce(econnResetError)
      .mockRejectedValueOnce(econnResetError);

    const request = makeRequest({ input: 'Lagos' });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ error: 'Internal server error' });
    expect(mockFetch).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });

  it('succeeds after retry on transient error', async () => {
    const mockGoogleData = createGoogleResponse([
      {
        placeId: 'ChIJ1234',
        mainText: 'Lagos',
        secondaryText: 'Nigeria',
        fullText: 'Lagos, Nigeria',
      },
    ]);

    mockFetch
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockGoogleData,
        text: async () => JSON.stringify(mockGoogleData),
      } as Response);

    const request = makeRequest({ input: 'Lagos' });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.predictions).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(2); // Initial + 1 retry
  });

  it('retries a transient UNKNOWN_ERROR response and succeeds', async () => {
    const mockGoogleData = createGoogleResponse([
      {
        placeId: 'ChIJ1234',
        mainText: 'Lagos',
        secondaryText: 'Nigeria',
        fullText: 'Lagos, Nigeria',
      },
    ]);

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'UNKNOWN_ERROR' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockGoogleData,
        text: async () => JSON.stringify(mockGoogleData),
      } as Response);

    const response = await GET(makeRequest({ input: 'Lagos' }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.predictions).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(2); // Initial + 1 retry
  });

  it('returns 502 when UNKNOWN_ERROR persists through retries', async () => {
    const unknownError = {
      ok: true,
      json: async () => ({ status: 'UNKNOWN_ERROR' }),
    } as Response;

    // Will retry twice (total 3 attempts)
    mockFetch
      .mockResolvedValueOnce(unknownError)
      .mockResolvedValueOnce(unknownError)
      .mockResolvedValueOnce(unknownError);

    const response = await GET(makeRequest({ input: 'Lagos' }));
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data).toEqual({
      error: 'Failed to fetch predictions',
      code: 'PLACES_AUTOCOMPLETE_UPSTREAM_ERROR',
    });
    expect(mockFetch).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });

  it('returns a safe 429 response when Legacy Places reports a quota limit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'OVER_QUERY_LIMIT',
        error_message: 'Provider detail that must not reach the client',
      }),
    } as Response);

    const response = await GET(makeRequest({ input: 'Lagos' }));
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data).toEqual({
      error: 'Failed to fetch predictions',
      code: 'PLACES_AUTOCOMPLETE_UPSTREAM_ERROR',
    });
  });

  it('preserves 429 for an HTTP-level upstream quota response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
    } as Response);

    const response = await GET(makeRequest({ input: 'Lagos' }));
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data).toEqual({
      error: 'Failed to fetch predictions',
      code: 'PLACES_AUTOCOMPLETE_HTTP_ERROR',
    });
  });
});
