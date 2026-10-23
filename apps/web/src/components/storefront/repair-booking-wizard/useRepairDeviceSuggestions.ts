'use client';

import type { RepairDeviceSummary } from '@baci/shared/repairs';
import { useEffect, useRef, useState } from 'react';
import { apiGet } from '@/lib/api-client';
import {
  type RepairDeviceSelection,
  type RepairDevicesResponse,
  type StorefrontProductDeviceCandidate,
  type StoreProductDeviceSuggestion,
  toStoreProductSuggestion,
} from './repair-device-suggestions';

const PRODUCT_SEARCH_CANDIDATE_LIMIT = 50;

interface UseRepairDeviceSuggestionsOptions {
  catalogEnabled: boolean;
  merchantId?: string;
  merchantSlug: string;
  query: string;
  repairCatalogEnabled: boolean;
  selectedModel: string | null;
}

export function useRepairDeviceSuggestions({
  catalogEnabled,
  merchantId,
  merchantSlug,
  query,
  repairCatalogEnabled,
  selectedModel,
}: UseRepairDeviceSuggestionsOptions) {
  const [suggestions, setSuggestions] = useState<RepairDeviceSelection[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [lookupFailed, setLookupFailed] = useState(false);
  const [settledQuery, setSettledQuery] = useState<string | null>(null);
  const activeControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setSuggestions([]);
    setHasSearched(false);
    setIsLoading(false);
    setLookupFailed(false);
    setSettledQuery(null);

    if (!catalogEnabled || query.length < 2 || query === selectedModel) {
      return;
    }

    const controller = new AbortController();
    activeControllerRef.current = controller;
    const timer = window.setTimeout(() => {
      setIsLoading(true);
      setLookupFailed(false);
      void (async () => {
        const repairRequest: Promise<RepairDeviceSummary[]> =
          repairCatalogEnabled
            ? apiGet<RepairDevicesResponse>(
                `/api/storefront/${encodeURIComponent(merchantSlug)}/repairs/devices?q=${encodeURIComponent(query)}`,
                { signal: controller.signal }
              ).then(({ groups }) =>
                groups.flatMap((group) => group.devices).slice(0, 8)
              )
            : Promise.resolve([]);
        const productsRequest: Promise<StorefrontProductDeviceCandidate[]> =
          merchantId
            ? apiGet<{
                products: StorefrontProductDeviceCandidate[];
              }>(
                `/api/storefront/products?merchant_id=${encodeURIComponent(merchantId)}&q=${encodeURIComponent(query)}&limit=${PRODUCT_SEARCH_CANDIDATE_LIMIT}&compact=true`,
                { signal: controller.signal }
              ).then(({ products }) => products)
            : Promise.resolve([]);
        const [repairResult, productsResult] = await Promise.allSettled([
          repairRequest,
          productsRequest,
        ]);

        if (controller.signal.aborted) return;
        const repairDevices =
          repairResult.status === 'fulfilled' ? repairResult.value : [];
        if (repairDevices.length > 0) {
          setSuggestions(repairDevices);
          setHasSearched(true);
          setSettledQuery(query);
          setIsLoading(false);
          return;
        }

        const storeSuggestions =
          productsResult.status === 'fulfilled'
            ? productsResult.value
                .map(toStoreProductSuggestion)
                .filter(
                  (product): product is StoreProductDeviceSuggestion =>
                    product !== null
                )
                .slice(0, 8)
            : [];
        setSuggestions(storeSuggestions);
        setHasSearched(true);
        setSettledQuery(query);
        setLookupFailed(
          (repairCatalogEnabled && repairResult.status === 'rejected') ||
            (merchantId !== undefined && productsResult.status === 'rejected')
        );
        setIsLoading(false);
      })();
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (activeControllerRef.current === controller) {
        activeControllerRef.current = null;
      }
    };
  }, [
    catalogEnabled,
    merchantId,
    merchantSlug,
    query,
    repairCatalogEnabled,
    selectedModel,
  ]);

  const clearSuggestions = () => {
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;
    setSuggestions([]);
    setIsLoading(false);
    setHasSearched(false);
    setLookupFailed(false);
    setSettledQuery(null);
  };

  return {
    clearSuggestions,
    hasSearched: hasSearched && settledQuery === query,
    isLoading,
    lookupFailed: lookupFailed && settledQuery === query,
    suggestions: settledQuery === query ? suggestions : [],
  };
}
