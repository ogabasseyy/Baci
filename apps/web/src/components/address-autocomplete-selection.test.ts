import { beforeEach, expect, it, vi } from 'vitest';
import { getPlaceDetails, type PlacePrediction } from '@/lib/google-places';
import { selectAddressPrediction } from './address-autocomplete-selection';

vi.mock('@/lib/google-places', () => ({
  generateSessionToken: () => 'fresh-session',
  getPlaceDetails: vi.fn(),
}));
const prediction: PlacePrediction = {
  provider: 'geoapify',
  placeId: 'geoapify:id',
  mainText: '20 Allen Avenue',
  secondaryText: 'Ikeja, Lagos',
  fullText: '20 Allen Avenue, Ikeja, Lagos',
  details: {
    placeId: 'geoapify:id',
    formattedAddress: '20 Allen Avenue, Ikeja, Lagos',
    city: 'Ikeja',
    state: 'Lagos',
    location: { latitude: 6.6, longitude: 3.3 },
  },
};
const callbacks = () => ({
  onSelect: vi.fn(),
  onError: vi.fn(),
  setSessionToken: vi.fn(),
  setIsLoading: vi.fn(),
  setSelectedProvider: vi.fn(),
});
beforeEach(() => vi.clearAllMocks());

it('uses Geoapify inline fields without any Google Details request', async () => {
  const cb = callbacks();
  await selectAddressPrediction(prediction, 'session', cb, () => true);
  expect(getPlaceDetails).not.toHaveBeenCalled();
  expect(cb.onSelect).toHaveBeenCalledWith(
    expect.objectContaining({
      formattedAddress: prediction.fullText,
      city: 'Ikeja',
      state: 'Lagos',
      location: { latitude: 6.6, longitude: 3.3 },
    })
  );
  expect(cb.onError).toHaveBeenCalledWith(false);
  expect(cb.setSelectedProvider).toHaveBeenCalledWith('geoapify');
  expect(cb.setSessionToken).toHaveBeenCalledWith('fresh-session');
  expect(cb.setIsLoading).toHaveBeenCalledWith(false);
});
it('never sends a malformed Geoapify selection to Google', async () => {
  const cb = callbacks();
  await selectAddressPrediction(
    { ...prediction, details: undefined },
    'session',
    cb,
    () => true
  );
  expect(getPlaceDetails).not.toHaveBeenCalled();
  expect(cb.onSelect).not.toHaveBeenCalled();
  expect(cb.onError).toHaveBeenCalledWith(true);
});
it('preserves the Google session token and Details flow', async () => {
  vi.mocked(getPlaceDetails).mockResolvedValue(prediction.details ?? null);
  const cb = callbacks();
  await selectAddressPrediction(
    {
      ...prediction,
      provider: 'google',
      placeId: 'google-id',
      details: undefined,
    },
    'session',
    cb,
    () => true
  );
  expect(getPlaceDetails).toHaveBeenCalledWith('google-id', 'session');
  expect(cb.onSelect).toHaveBeenCalledOnce();
});
it('offers manual entry when a Google Details lookup fails', async () => {
  vi.mocked(getPlaceDetails).mockResolvedValue(null);
  const cb = callbacks();
  await selectAddressPrediction(
    { ...prediction, provider: 'google', placeId: 'google-id' },
    'session',
    cb,
    () => true
  );
  expect(cb.onSelect).not.toHaveBeenCalled();
  expect(cb.onError).toHaveBeenCalledWith(true);
});
it('ignores an obsolete selection without mutating form, error or loading state', async () => {
  const cb = callbacks();
  await selectAddressPrediction(prediction, 'session', cb, () => false);
  for (const callback of Object.values(cb))
    expect(callback).not.toHaveBeenCalled();
});
