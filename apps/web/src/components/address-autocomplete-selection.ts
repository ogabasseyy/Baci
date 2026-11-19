import {
  generateSessionToken,
  getPlaceDetails,
  type PlacePrediction,
} from '@/lib/google-places';
import type { PlaceDetails } from './address-autocomplete-types';

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
  if (!shouldApplyResult()) return;
  // Details may complete a Google billing session even when a later edit makes
  // its result obsolete. Reserve a fresh token for the next search immediately;
  // the in-flight Details request still receives the original session token.
  callbacks.setSessionToken(generateSessionToken());
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
        lga: details.lga || '',
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
      callbacks.setIsLoading(false);
    }
  }
}
