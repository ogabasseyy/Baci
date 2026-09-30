import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiGet } from '@/lib/api-client';
import {
  getPlaceDetails,
  getPlaceDetailsServer,
  getPlacePredictions,
} from '@/lib/google-places';

vi.mock('@/lib/api-client', () => ({
  apiGet: vi.fn(),
}));

const mockApiGet = vi.mocked(apiGet);

describe('google places client helpers', () => {
  beforeEach(() => {
    mockApiGet.mockReset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('skips prediction lookups for empty or one-character input', async () => {
    await expect(getPlacePredictions('')).resolves.toEqual([]);
    await expect(getPlacePredictions('a')).resolves.toEqual([]);

    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it('fetches predictions with session and country query params', async () => {
    const predictions = [
      {
        placeId: 'places/address-1',
        mainText: '12 Baci Street',
        secondaryText: 'Lagos, Nigeria',
        fullText: '12 Baci Street, Lagos, Nigeria',
      },
    ];
    mockApiGet.mockResolvedValueOnce({ predictions });

    await expect(
      getPlacePredictions('Baci Street', 'session-123', 'ng')
    ).resolves.toEqual(predictions);

    expect(mockApiGet).toHaveBeenCalledWith(
      '/api/places/autocomplete?input=Baci+Street&fallback=geoapify&sessionToken=session-123&country=ng'
    );
  });

  it('returns an empty prediction list when the API omits predictions', async () => {
    mockApiGet.mockResolvedValueOnce({ predictions: undefined });

    await expect(getPlacePredictions('Baci Street')).resolves.toEqual([]);
  });

  it('propagates prediction lookup failures to the caller', async () => {
    const failure = new Error('places unavailable');
    mockApiGet.mockRejectedValueOnce(failure);

    await expect(getPlacePredictions('Baci Street')).rejects.toThrow(
      'places unavailable'
    );
  });

  it('returns null for missing place details input and does not call the API', async () => {
    await expect(getPlaceDetails('')).resolves.toBeNull();

    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it('returns place details from the API route', async () => {
    const details = {
      placeId: 'places/address-1',
      formattedAddress: '12 Baci Street, Lagos, Nigeria',
      city: 'Lagos',
      state: 'Lagos',
      country: 'Nigeria',
    };
    mockApiGet.mockResolvedValueOnce({ details });

    await expect(
      getPlaceDetails('places/address-1', 'session-123')
    ).resolves.toEqual(details);

    expect(mockApiGet).toHaveBeenCalledWith(
      '/api/places/details?placeId=places%2Faddress-1&sessionToken=session-123'
    );
  });

  it('returns null when place details lookup fails', async () => {
    mockApiGet.mockRejectedValueOnce(new Error('details unavailable'));

    await expect(getPlaceDetails('places/address-1')).resolves.toBeNull();
  });

  it('returns null for server details when no API key is configured', async () => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', '');
    vi.stubEnv('GOOGLE_MAPS_API_KEY', '');

    await expect(getPlaceDetailsServer('places/address-1')).resolves.toBeNull();
  });

  it('fetches server details with Google field masks', async () => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'server-key');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ rating: 4.8, userRatingCount: 120 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getPlaceDetailsServer('address-1')).resolves.toEqual({
      rating: 4.8,
      userRatingCount: 120,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://places.googleapis.com/v1/places/address-1',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Goog-Api-Key': 'server-key',
          'X-Goog-FieldMask': 'reviews,rating,userRatingCount',
        }),
        method: 'GET',
        next: { revalidate: 3600 },
      })
    );
  });
});
