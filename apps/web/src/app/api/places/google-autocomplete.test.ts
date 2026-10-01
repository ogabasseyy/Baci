import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchGoogleAutocomplete } from './google-autocomplete';
import { fetchLegacyPlacesJson } from './legacy-places';
import { reserveGooglePlacesRequest } from './provider-budget';

vi.mock('./legacy-places', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./legacy-places')>()),
  fetchLegacyPlacesJson: vi.fn(),
}));
vi.mock('./provider-budget', () => ({
  reserveGooglePlacesRequest: vi.fn(async () => true),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('GOOGLE_PLACES_API_KEY', 'places-test-key');
  vi.stubEnv('GOOGLE_MAPS_API_KEY', 'maps-test-key');
});
afterEach(() => vi.unstubAllEnvs());

function legacyResponse<T extends { status?: string }>(data: T) {
  return { ok: true as const, status: 200, data };
}

describe('Google autocomplete provider boundary', () => {
  it('normalizes predictions, excludes invalid IDs, and reserves each upstream attempt', async () => {
    vi.mocked(fetchLegacyPlacesJson).mockResolvedValue(
      legacyResponse({
        status: 'OK',
        predictions: [
          {
            place_id: 'place',
            description: 'Lagos, Nigeria',
            structured_formatting: {
              main_text: 'Lagos',
              secondary_text: 'Nigeria',
            },
          },
          { place_id: '', description: 'Invalid' },
          { description: 'Missing ID' },
        ],
      })
    );
    const result = await fetchGoogleAutocomplete('Lagos', 'session', 'ng');
    expect(result).toEqual({
      status: 200,
      body: {
        predictions: [
          {
            placeId: 'place',
            mainText: 'Lagos',
            secondaryText: 'Nigeria',
            fullText: 'Lagos, Nigeria',
            description: 'Lagos, Nigeria',
          },
        ],
      },
    });
    const [rawUrl, beforeAttempt] = vi.mocked(fetchLegacyPlacesJson).mock
      .calls[0];
    const url = new URL(rawUrl);
    expect(url.searchParams.get('key')).toBe('places-test-key');
    expect(url.searchParams.get('sessiontoken')).toBe('session');
    expect(url.searchParams.get('components')).toBe('country:ng');
    expect(await beforeAttempt?.()).toBe(true);
    expect(reserveGooglePlacesRequest).toHaveBeenCalledWith('autocomplete');
    expect(JSON.stringify(result)).not.toContain('places-test-key');
  });
  it('uses the Maps key and description when optional formatting is missing', async () => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', '');
    vi.mocked(fetchLegacyPlacesJson).mockResolvedValue(
      legacyResponse({
        status: 'OK',
        predictions: [{ place_id: 'place', description: 'Lagos' }],
      })
    );
    const result = await fetchGoogleAutocomplete('Lagos');
    expect(result.body.predictions?.[0]).toMatchObject({
      mainText: 'Lagos',
      secondaryText: '',
    });
    expect(
      new URL(
        vi.mocked(fetchLegacyPlacesJson).mock.calls[0][0]
      ).searchParams.get('key')
    ).toBe('maps-test-key');
  });
  it('does not reserve or fetch when no Google key is configured', async () => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', '');
    vi.stubEnv('GOOGLE_MAPS_API_KEY', '');
    expect(await fetchGoogleAutocomplete('Lagos')).toMatchObject({
      status: 500,
      body: { error: 'Google Places API not configured' },
    });
    expect(fetchLegacyPlacesJson).not.toHaveBeenCalled();
    expect(reserveGooglePlacesRequest).not.toHaveBeenCalled();
  });
  it.each([
    'ZERO_RESULTS',
    'OK',
  ])('returns an empty success for %s without predictions', async (status) => {
    vi.mocked(fetchLegacyPlacesJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: { status },
    });
    expect(await fetchGoogleAutocomplete('Lagos')).toEqual({
      status: 200,
      body: { predictions: [] },
    });
  });
  it.each([
    ['INVALID_REQUEST', 400],
    ['OVER_QUERY_LIMIT', 429],
    ['OVER_DAILY_LIMIT', 429],
    ['REQUEST_DENIED', 502],
    ['UNKNOWN_ERROR', 502],
  ])('maps Google status %s to a safe %s response', async (status, expected) => {
    vi.mocked(fetchLegacyPlacesJson).mockResolvedValue(
      legacyResponse({ status, error_message: 'provider secret' })
    );
    const result = await fetchGoogleAutocomplete('Lagos');
    expect(result.status).toBe(expected);
    expect(JSON.stringify(result)).not.toContain('provider secret');
  });
  it.each([
    [429, 429],
    [403, 502],
    [500, 502],
  ])('maps transport status %s to %s', async (status, expected) => {
    vi.mocked(fetchLegacyPlacesJson).mockResolvedValue({ ok: false, status });
    expect((await fetchGoogleAutocomplete('Lagos')).status).toBe(expected);
  });
  it('does not expose unexpected provider exceptions', async () => {
    vi.mocked(fetchLegacyPlacesJson).mockRejectedValue(
      new Error('provider secret')
    );
    expect(await fetchGoogleAutocomplete('Lagos')).toEqual({
      status: 500,
      body: { error: 'Internal server error' },
    });
  });
  it.each([
    new DOMException('Timed out', 'TimeoutError'),
    new DOMException('Aborted', 'AbortError'),
    new TypeError('fetch failed'),
  ])('classifies exhausted transport errors as a safe gateway failure: %s', async (error) => {
    vi.mocked(fetchLegacyPlacesJson).mockRejectedValue(error);
    expect(await fetchGoogleAutocomplete('Lagos')).toEqual({
      status: 502,
      body: {
        error: 'Failed to fetch predictions',
        code: 'PLACES_AUTOCOMPLETE_HTTP_ERROR',
      },
    });
  });
});
