// Client hook subscribes to runtime capabilities and starts requests after paint.
'use client';

import {
  createRuntimeImeiAvailability,
  fetchRuntimeImeiTierKeys,
  type ImeiDeviceCategory,
} from '@baci/shared/imei';
import { useEffect, useState, useSyncExternalStore } from 'react';

export function useImeiRuntimeAvailability(device: ImeiDeviceCategory) {
  const [availability] = useState(() =>
    createRuntimeImeiAvailability({ fetchTierKeys: fetchRuntimeImeiTierKeys })
  );
  const snapshot = useSyncExternalStore(
    availability.subscribe,
    availability.getSnapshot,
    availability.getSnapshot
  );
  useEffect(() => availability.load(device), [availability, device]);
  return availability.getView(device, snapshot);
}
