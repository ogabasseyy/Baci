import { getPlacePredictions, type PlacePrediction } from '@/lib/google-places';

export async function loadPredictions(
  query: string,
  sessionToken: string,
  country: string | undefined,
  setPredictions: (predictions: PlacePrediction[]) => void,
  setIsLoading: (loading: boolean) => void,
  shouldApplyResult: () => boolean,
  onError?: (failed: boolean) => void
): Promise<void> {
  try {
    const results = await getPlacePredictions(query, sessionToken, country);
    if (!shouldApplyResult()) return;
    setPredictions(results);
    onError?.(false);
  } catch {
    if (!shouldApplyResult()) return;
    setPredictions([]);
    onError?.(true);
  } finally {
    if (shouldApplyResult()) setIsLoading(false);
  }
}
