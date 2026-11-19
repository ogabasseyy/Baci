import {
  createRuntimeImeiAvailability,
  fetchRuntimeImeiTierKeys,
  type ImeiDeviceCategory,
} from '@baci/shared/imei';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { resolveStorefrontApiBaseUrl } from '@/lib/storefront-api-url';

const API_BASE_URL = resolveStorefrontApiBaseUrl(
  process.env.EXPO_PUBLIC_STOREFRONT_API_URL,
  process.env.EXPO_PUBLIC_API_URL
);

export function useImeiRuntimeAvailability(device: ImeiDeviceCategory) {
  const [availability] = useState(() =>
    createRuntimeImeiAvailability({
      fetchTierKeys: fetchRuntimeImeiTierKeys,
      apiBaseUrl: API_BASE_URL,
    })
  );
  const snapshot = useSyncExternalStore(
    availability.subscribe,
    availability.getSnapshot,
    availability.getSnapshot
  );
  useEffect(() => availability.load(device), [availability, device]);
  return availability.getView(device, snapshot);
}
