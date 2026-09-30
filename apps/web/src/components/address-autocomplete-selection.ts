import {
  generateSessionToken,
  getPlaceDetails,
  type PlacePrediction,
} from '@/lib/google-places';
import type { PlaceDetails } from './address-autocomplete';

interface SelectionCallbacks {
  onSelect?: (place: PlaceDetails) => void;
  onError?: (failed: boolean) => void;
  setSessionToken: (token: string) => void;
  setIsLoading: (loading: boolean) => void;
  setSelectedProvider: (provider: 'google' | 'geoapify') => void;
}

export async function selectAddressPrediction(
  prediction: PlacePrediction,
  sessionToken: string,
  callbacks: SelectionCallbacks,
  shouldApplyResult: () => boolean
): Promise<void> {
  try {
    const isGeoapify =
      prediction.provider === 'geoapify' ||
      prediction.placeId.startsWith('geoapify:');
    const details = isGeoapify
      ? prediction.details
      : await getPlaceDetails(prediction.placeId, sessionToken);
    if (!shouldApplyResult()) return;
    callbacks.onError?.(!details);
    if (details) {
      callbacks.onSelect?.({
        streetNumber: details.streetNumber || '',
        route: details.route || '',
        city: details.city || '',
        state: details.state || '',
        zip: details.postalCode || '',
        country: details.country || '',
        formattedAddress: details.formattedAddress,
        location: details.location,
      });
      callbacks.setSelectedProvider(isGeoapify ? 'geoapify' : 'google');
    }
  } catch {
    if (shouldApplyResult()) callbacks.onError?.(true);
  } finally {
    if (shouldApplyResult()) {
      callbacks.setSessionToken(generateSessionToken());
      callbacks.setIsLoading(false);
    }
  }
}
