interface GoogleAddressDetails {
  city: string;
  state: string;
  country: string;
  countryCode: string;
  postalCode: string;
  latitude?: number;
  longitude?: number;
}

export function parseGoogleAddressDetails(
  details: unknown
): GoogleAddressDetails {
  const value = details as {
    address_components?: Array<{
      long_name?: string;
      short_name?: string;
      types?: string[];
    }>;
    geometry?: { location?: { lat?: number; lng?: number } };
  };
  const components = value.address_components ?? [];
  const find = (type: string) =>
    components.find((component) => component.types?.includes(type));
  const locality =
    find('locality') ??
    find('postal_town') ??
    find('administrative_area_level_2');
  const state = find('administrative_area_level_1');
  const country = find('country');
  const postal = find('postal_code');
  return {
    city: locality?.long_name?.trim() ?? '',
    state: state?.long_name?.trim() ?? '',
    country: country?.long_name?.trim() ?? '',
    countryCode: country?.short_name?.trim() ?? '',
    postalCode: postal?.long_name?.trim() ?? '',
    latitude:
      typeof value.geometry?.location?.lat === 'number'
        ? value.geometry.location.lat
        : undefined,
    longitude:
      typeof value.geometry?.location?.lng === 'number'
        ? value.geometry.location.lng
        : undefined,
  };
}

function buildGoogleDetailsUrl({
  googleMapsApiKey,
  placeId,
}: {
  googleMapsApiKey: string;
  placeId: string;
}) {
  const params = new URLSearchParams({
    key: googleMapsApiKey,
    place_id: placeId,
    fields: 'address_components,geometry',
  });
  return `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`;
}

export const GOOGLE_ADDRESS_DETAILS_TIMEOUT_MS = 10_000;

function createDetailsTimeoutSignal(timeoutMs: number): AbortSignal {
  const nativeTimeout = AbortSignal.timeout;
  if (typeof nativeTimeout === 'function') {
    return nativeTimeout(timeoutMs);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

export async function fetchGoogleAddressDetails({
  googleMapsApiKey,
  placeId,
}: {
  googleMapsApiKey: string;
  placeId: string;
}): Promise<GoogleAddressDetails | null> {
  try {
    const response = await fetch(
      buildGoogleDetailsUrl({ googleMapsApiKey, placeId }),
      { signal: createDetailsTimeoutSignal(GOOGLE_ADDRESS_DETAILS_TIMEOUT_MS) }
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      result?: unknown;
      status?: string;
    };
    if (payload.status !== 'OK' || !payload.result) return null;
    return parseGoogleAddressDetails(payload.result);
  } catch (error) {
    // Timeouts and aborts are recoverable: callers enter manual locality recovery.
    if (
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')
    ) {
      return null;
    }
    throw error;
  }
}
