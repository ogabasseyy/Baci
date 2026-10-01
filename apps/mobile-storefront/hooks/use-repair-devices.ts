import type { RepairDeviceBrandGroup } from '@baci/shared/repairs';
import { useEffect, useRef, useState } from 'react';
import {
  fetchRepairDevices,
  RepairCatalogTimeoutError,
  RepairCatalogUnavailableError,
} from '@/lib/repair-catalog-client';

export interface UseRepairDevicesResult {
  groups: RepairDeviceBrandGroup[];
  brandGroups: RepairDeviceBrandGroup[];
  isLoading: boolean;
  /** True when the catalogue is disabled/unavailable for this merchant (404) — render the WhatsApp fallback, not an error state. */
  isUnavailable: boolean;
  error: string | null;
  query: string;
  setQuery: (query: string) => void;
  refetch: () => void;
}

/**
 * Fetches the merchant's repair device catalogue (brand-grouped), debounced
 * on search-query changes. Mirrors the loading/error/unavailable split the
 * screen needs: `isUnavailable` routes to the pre-catalogue WhatsApp-only
 * fallback (today's behaviour), `error` is a real failure with a retry.
 */
export function useRepairDevices(): UseRepairDevicesResult {
  const [groups, setGroups] = useState<RepairDeviceBrandGroup[]>([]);
  const [brandGroups, setBrandGroups] = useState<RepairDeviceBrandGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [refetchToken, setRefetchToken] = useState(0);
  const requestIdRef = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetchToken intentionally retriggers the catalogue request.
  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    fetchRepairDevices(query, controller.signal)
      .then((result) => {
        if (requestIdRef.current !== requestId) return;
        setGroups(result);
        if (!query.trim()) {
          setBrandGroups(result);
        }
        setIsUnavailable(false);
      })
      .catch((err: unknown) => {
        if (requestIdRef.current !== requestId) return;
        if (err instanceof RepairCatalogUnavailableError) {
          setIsUnavailable(true);
          setGroups([]);
          return;
        }
        if (err instanceof RepairCatalogTimeoutError) {
          setError('Repair options took too long to load. Please try again.');
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load devices');
      })
      .finally(() => {
        if (requestIdRef.current === requestId) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [query, refetchToken]);

  return {
    groups,
    brandGroups,
    isLoading,
    isUnavailable,
    error,
    query,
    setQuery,
    refetch: () => setRefetchToken((token) => token + 1),
  };
}
