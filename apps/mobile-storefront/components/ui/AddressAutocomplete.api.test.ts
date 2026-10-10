import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { FetchImplementation } from '@/types/fetch';
import { fetchPlaceDetails } from './AddressAutocomplete.api';
import type { PlacePrediction } from './AddressAutocomplete.types';

jest.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { apiUrl: 'http://localhost:3000' } } },
}));

const prediction: PlacePrediction = {
  description: '1 Airport Road, Port Harcourt',
  mainText: '1 Airport Road',
  placeId: 'place-1',
  secondaryText: 'Port Harcourt, Nigeria',
};
const fetchMock = jest.fn<FetchImplementation>();

function mockDetails(location?: unknown) {
  fetchMock.mockResolvedValueOnce({
    json: async () => ({
      details: {
        city: 'Port Harcourt',
        formattedAddress: prediction.description,
        location,
        state: 'Rivers',
      },
    }),
    ok: true,
  } as Response);
}

describe('fetchPlaceDetails coordinates', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it('preserves numeric coordinates', async () => {
    mockDetails({ latitude: 4.8156, longitude: 7.0498 });

    await expect(
      fetchPlaceDetails({ prediction, sessionToken: 'session-1' })
    ).resolves.toMatchObject({ latitude: 4.8156, longitude: 7.0498 });
  });

  it.each([
    ['missing location', undefined],
    ['non-numeric coordinates', { latitude: '4.8156', longitude: '7.0498' }],
  ])('omits coordinates for %s', async (_label, location) => {
    mockDetails(location);

    await expect(
      fetchPlaceDetails({ prediction, sessionToken: 'session-1' })
    ).resolves.toMatchObject({ latitude: undefined, longitude: undefined });
  });
});
