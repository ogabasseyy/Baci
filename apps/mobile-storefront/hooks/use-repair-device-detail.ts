import type { RepairDeviceDetail } from '@baci/shared/repairs';
import { useEffect, useRef, useState } from 'react';
import {
  fetchRepairDeviceDetail,
  RepairCatalogTimeoutError,
  RepairCatalogUnavailableError,
} from '@/lib/repair-catalog-client';

export interface UseRepairDeviceDetailResult {
  detail: RepairDeviceDetail | null;
  isLoading: boolean;
  isNotFound: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Fetches one device's catalogue detail (quotes + linked product) by slug.
 * Skips the request entirely for an empty slug (guards a bad/partial deep
 * link before it ever reaches the network).
 */
export function useRepairDeviceDetail(
  deviceSlug: string
): UseRepairDeviceDetailResult {
  const [detail, setDetail] = useState<RepairDeviceDetail | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(deviceSlug));
  const [isNotFound, setIsNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refetchToken, setRefetchToken] = useState(0);
  const requestIdRef = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetchToken intentionally retriggers the detail request.
  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setDetail(null);
    setError(null);
    setIsNotFound(false);

    if (!deviceSlug) {
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);

    fetchRepairDeviceDetail(deviceSlug, controller.signal)
      .then((result) => {
        if (requestIdRef.current !== requestId) return;
        setDetail(result);
      })
      .catch((err: unknown) => {
        if (requestIdRef.current !== requestId) return;
        if (err instanceof RepairCatalogUnavailableError) {
          setIsNotFound(true);
          setDetail(null);
          return;
        }
        if (err instanceof RepairCatalogTimeoutError) {
          setError('Repair options took too long to load. Please try again.');
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load device');
      })
      .finally(() => {
        if (requestIdRef.current === requestId) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [deviceSlug, refetchToken]);

  return {
    detail,
    isLoading,
    isNotFound,
    error,
    refetch: () => setRefetchToken((token) => token + 1),
  };
}
