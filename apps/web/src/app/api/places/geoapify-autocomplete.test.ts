import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchGeoapifyPredictions } from './geoapify-autocomplete';
import { reserveGeoapifyRequest } from './provider-budget';

vi.mock('./provider-budget', () => ({
  reserveGeoapifyRequest: vi.fn(async () => true),
}));
const result = {
  place_id: 'id-1',
  formatted: '20 Allen Avenue, Ikeja, Nigeria',
  address_line1: '20 Allen Avenue',
  housenumber: '20',
  street: 'Allen Avenue',
  city: 'Ikeja',
  state: 'Lagos',
  country: 'Nigeria',
  country_code: 'ng',
  lat: 6.6,
  lon: 3.3,
  result_type: 'building',
  rank: { confidence_building_level: 1 },
};
const mockFetch = vi.fn();
function respond(results: unknown[]) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ results }),
  });
}

describe('Geoapify address mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
    vi.stubEnv('GEOAPIFY_API_KEY', 'private-test-key');
    vi.mocked(reserveGeoapifyRequest).mockResolvedValue(true);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('returns only normalized address data with usable coordinates', async () => {
    respond([{ ...result, apiKey: 'private-test-key' }]);
    const predictions = await fetchGeoapifyPredictions('20 Allen Avenue', 'ng');
    expect(predictions[0].details).toMatchObject({
      formattedAddress: result.formatted,
      streetNumber: '20',
      city: 'Ikeja',
      state: 'Lagos',
      location: { latitude: 6.6, longitude: 3.3 },
    });
    expect(JSON.stringify(predictions)).not.toContain('private-test-key');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        cache: 'no-store',
        opentelemetry: { ignore: true },
      })
    );
  });
  it.each([
    { result_type: 'city', rank: { confidence_building_level: 1 } },
    { result_type: 'building', rank: { confidence_building_level: 0 } },
    { result_type: 'street', rank: { confidence_street_level: 0.3 } },
    { result_type: 'amenity', rank: undefined },
  ])('does not present a coarse or guessed coordinate as a delivery location: %j', async (overrides) => {
    respond([{ ...result, ...overrides }]);
    expect(
      (await fetchGeoapifyPredictions('Allen Avenue', 'ng'))[0].details
        ?.location
    ).toBeNull();
  });
  it('filters out results outside the selected country', async () => {
    respond([{ ...result, country_code: 'gb' }, result]);
    expect(await fetchGeoapifyPredictions('Allen Avenue', 'ng')).toHaveLength(
      1
    );
  });
  it.each([
    undefined,
    '',
  ])('keeps a country-filtered address when country metadata is absent: %s', async (countryCode) => {
    respond([{ ...result, country_code: countryCode }]);
    const predictions = await fetchGeoapifyPredictions('Allen Avenue', 'ng');
    expect(predictions).toHaveLength(1);
    expect(predictions[0].details).toMatchObject({
      city: 'Ikeja',
      country: 'Nigeria',
    });
    const url = new URL(String(mockFetch.mock.calls[0][0]));
    expect(url.searchParams.get('filter')).toBe('countrycode:ng');
  });
  it('rejects invalid upstream coordinates safely', async () => {
    respond([{ ...result, lat: 91 }]);
    await expect(
      fetchGeoapifyPredictions('Allen Avenue', 'ng')
    ).rejects.toMatchObject({ status: 502 });
  });
  it('returns no matches for a valid empty result', async () => {
    respond([]);
    expect(await fetchGeoapifyPredictions('unknown', 'ng')).toEqual([]);
  });
  it('does not call Geoapify without a key or after the cap', async () => {
    vi.stubEnv('GEOAPIFY_API_KEY', '');
    await expect(
      fetchGeoapifyPredictions('Allen Avenue')
    ).rejects.toMatchObject({ status: 503 });
    vi.stubEnv('GEOAPIFY_API_KEY', 'private-test-key');
    vi.mocked(reserveGeoapifyRequest).mockResolvedValue(false);
    await expect(
      fetchGeoapifyPredictions('Allen Avenue')
    ).rejects.toMatchObject({ status: 429 });
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each([
    429, 403, 500,
  ])('handles upstream HTTP %s without exposing response bodies', async (status) => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status,
      json: async () => ({ error: 'private-test-key' }),
    });
    await expect(
      fetchGeoapifyPredictions('Allen Avenue')
    ).rejects.toMatchObject({
      status: status === 429 ? 429 : 502,
      message: 'Address suggestions are temporarily unavailable',
    });
  });
});
