import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGoogleAddressDetails } from './google-address-details';

afterEach(() => vi.restoreAllMocks());

describe('fetchGoogleAddressDetails', () => {
  it('parses trusted details from a successful response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'OK',
          result: {
            address_components: [
              { long_name: 'Osu', short_name: 'Osu', types: ['locality'] },
              {
                long_name: 'Greater Accra',
                short_name: 'GA',
                types: ['administrative_area_level_1'],
              },
              { long_name: 'Ghana', short_name: 'GH', types: ['country'] },
              {
                long_name: '00233',
                short_name: '00233',
                types: ['postal_code'],
              },
            ],
            geometry: { location: { lat: 5.56, lng: -0.19 } },
          },
        }),
      })
    );

    await expect(
      fetchGoogleAddressDetails({ googleMapsApiKey: 'key', placeId: 'place' })
    ).resolves.toMatchObject({
      city: 'Osu',
      state: 'Greater Accra',
      countryCode: 'GH',
      postalCode: '00233',
      latitude: 5.56,
      longitude: -0.19,
    });
  });

  it.each([
    [{ status: 'ZERO_RESULTS', result: {} }],
    [{ status: 'OK' }],
    [{ status: 'ERROR', result: { address_components: [] } }],
  ])('returns null for incomplete or non-OK response %j', async (payload) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => payload })
    );

    await expect(
      fetchGoogleAddressDetails({ googleMapsApiKey: 'key', placeId: 'place' })
    ).resolves.toBeNull();
  });

  it('returns null for an HTTP failure without reading its body', async () => {
    const json = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json }));

    await expect(
      fetchGoogleAddressDetails({ googleMapsApiKey: 'key', placeId: 'place' })
    ).resolves.toBeNull();
    expect(json).not.toHaveBeenCalled();
  });

  it('rejects network failures without fabricating locality', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(
      fetchGoogleAddressDetails({ googleMapsApiKey: 'key', placeId: 'place' })
    ).rejects.toThrow('offline');
  });

  it('returns null when the Places Details request times out', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    await expect(
      fetchGoogleAddressDetails({ googleMapsApiKey: 'key', placeId: 'place' })
    ).resolves.toBeNull();
  });

  it('bugfix: requests plural address_components so locality/coords are returned', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'OK',
        result: {
          address_components: [
            { long_name: 'Lagos', types: ['locality'] },
            { long_name: 'Lagos', types: ['administrative_area_level_1'] },
            { long_name: 'Nigeria', short_name: 'NG', types: ['country'] },
          ],
          geometry: { location: { lat: 6.5, lng: 3.3 } },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchGoogleAddressDetails({
      googleMapsApiKey: 'key',
      placeId: 'place-1',
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      'fields=address_components%2Cgeometry'
    );
  });
});

describe('Google locality fallback', () => {
  it.each([
    ['postal_town', 'Kumasi'],
    ['administrative_area_level_2', 'Ashanti'],
  ])('uses %s when locality is absent', async (type, city) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'OK',
          result: {
            address_components: [{ long_name: city, types: [type] }],
          },
        }),
      })
    );

    await expect(
      fetchGoogleAddressDetails({ googleMapsApiKey: 'key', placeId: 'place' })
    ).resolves.toMatchObject({ city });
  });
});
