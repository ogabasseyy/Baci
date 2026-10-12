import { beforeEach, expect, it, vi } from 'vitest';
import { getPlacePredictions } from '@/lib/google-places';
import { loadPredictions } from './address-autocomplete-predictions';

vi.mock('@/lib/google-places', () => ({ getPlacePredictions: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

const prediction = {
  placeId: 'id',
  mainText: 'Lagos',
  secondaryText: 'Nigeria',
  fullText: 'Lagos, Nigeria',
};

function callbacks() {
  return { setPredictions: vi.fn(), setIsLoading: vi.fn(), onError: vi.fn() };
}

it('applies current predictions, clears failure, and finishes loading', async () => {
  vi.mocked(getPlacePredictions).mockResolvedValue([prediction]);
  const { setPredictions, setIsLoading, onError } = callbacks();
  await loadPredictions(
    'Lagos',
    'session',
    'NG',
    setPredictions,
    setIsLoading,
    () => true,
    onError
  );
  expect(getPlacePredictions).toHaveBeenCalledWith('Lagos', 'session', 'NG');
  expect(setPredictions).toHaveBeenCalledWith([prediction]);
  expect(onError).toHaveBeenCalledWith(false);
  expect(setIsLoading).toHaveBeenCalledWith(false);
});

it('clears suggestions and reports a current provider failure for manual entry', async () => {
  vi.mocked(getPlacePredictions).mockRejectedValue(new Error('Unavailable'));
  const { setPredictions, setIsLoading, onError } = callbacks();
  await loadPredictions(
    'Lagos',
    'session',
    undefined,
    setPredictions,
    setIsLoading,
    () => true,
    onError
  );
  expect(setPredictions).toHaveBeenCalledWith([]);
  expect(onError).toHaveBeenCalledWith(true);
  expect(setIsLoading).toHaveBeenCalledWith(false);
});

it.each([
  false,
  true,
])('ignores stale success and failure, failed=%s', async (failed) => {
  if (failed)
    vi.mocked(getPlacePredictions).mockRejectedValue(new Error('Unavailable'));
  else vi.mocked(getPlacePredictions).mockResolvedValue([prediction]);
  const { setPredictions, setIsLoading, onError } = callbacks();
  await loadPredictions(
    'Lagos',
    'session',
    undefined,
    setPredictions,
    setIsLoading,
    () => false,
    onError
  );
  expect(setPredictions).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  expect(setIsLoading).not.toHaveBeenCalled();
});
