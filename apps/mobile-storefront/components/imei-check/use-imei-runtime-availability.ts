import {
  fetchRuntimeImeiTierKeys,
  type ImeiDeviceCategory,
  type ImeiServiceTierKey,
} from '@baci/shared/imei';
import { useEffect, useState } from 'react';
import { resolveStorefrontApiBaseUrl } from '@/lib/storefront-api-url';

const API_BASE_URL = resolveStorefrontApiBaseUrl(
  process.env.EXPO_PUBLIC_STOREFRONT_API_URL,
  process.env.EXPO_PUBLIC_API_URL
);

/** Fetch after paint; scope every reply to its device and cancel obsolete requests. */
export function useImeiRuntimeAvailability(device: ImeiDeviceCategory) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    device: ImeiDeviceCategory;
    attempt: number;
    keys: ImeiServiceTierKey[] | null;
    failed: boolean;
  } | null>(null);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (active) setResult({ device, attempt, keys: null, failed: true });
      active = false;
      controller.abort();
    }, 8000);
    fetchRuntimeImeiTierKeys({
      device,
      apiBaseUrl: API_BASE_URL,
      signal: controller.signal,
    })
      .then((keys) => {
        if (active) setResult({ device, attempt, keys, failed: false });
      })
      .catch(() => {
        if (active) setResult({ device, attempt, keys: null, failed: true });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [device, attempt]);
  const current =
    result?.device === device && result.attempt === attempt ? result : null;
  return {
    availableTierKeys: current?.keys ?? null,
    failed: current?.failed ?? false,
    loading: current === null,
    retry: () => setAttempt((value) => value + 1),
  };
}
