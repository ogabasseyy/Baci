import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../provider-budget', () => ({
  reserveGooglePlacesRequest: vi.fn(async () => ({ reserved: true })),
}));
const upstream = vi.fn();
vi.stubGlobal('fetch', upstream);
const { GET } = await import('./route');
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('GOOGLE_MAPS_API_KEY', 'test-key');
  vi.stubEnv('GOOGLE_PLACES_API_KEY', '');
});
async function details(country: string, area?: string) {
  upstream.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      status: 'OK',
      result: {
        formatted_address: '2 Example Street, Lagos, Lagos, Nigeria',
        address_components: [
          { long_name: 'Lagos', types: ['locality'] },
          { long_name: 'Lagos', types: ['administrative_area_level_1'] },
          ...(area
            ? [{ long_name: area, types: ['administrative_area_level_2'] }]
            : []),
          {
            long_name: country === 'NG' ? 'Nigeria' : 'Other country',
            short_name: country,
            types: ['country'],
          },
        ],
      },
    }),
  });
  const response = await GET(
    new NextRequest('http://localhost/api/places/details?placeId=test-place')
  );
  expect(response.status).toBe(200);
  return (await response.json()).details;
}
it('returns the Nigerian LGA separately even when city and state are both Lagos', async () => {
  const result = await details('NG', 'Ikeja');
  expect(result).toMatchObject({ city: 'Lagos', state: 'Lagos', lga: 'Ikeja' });
  expect(upstream).toHaveBeenCalledTimes(1);
  const url = new URL(upstream.mock.calls[0][0]);
  expect(url.searchParams.get('fields')).toBe(
    'address_components,formatted_address,geometry'
  );
});
it('does not copy the city into a missing LGA', async () => {
  expect(await details('NG')).toMatchObject({ city: 'Lagos', lga: '' });
});
it('does not label a foreign county as a Nigerian LGA', async () => {
  expect(await details('US', 'Some county')).toMatchObject({ lga: '' });
});
