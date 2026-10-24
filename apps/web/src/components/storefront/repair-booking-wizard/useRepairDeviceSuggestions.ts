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

const PRODUCT_SEARCH_PAGE_SIZE = 50;
const MAX_PRODUCT_SEARCH_PAGES = 5;
const MAX_REPAIR_DEVICE_SUGGESTIONS = 8;

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
  const [refreshVersion, setRefreshVersion] = useState(0);
  const activeControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const lastRefreshVersionRef = useRef(0);

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
    const shouldRefreshImmediately =
      refreshVersion > lastRefreshVersionRef.current;
    lastRefreshVersionRef.current = refreshVersion;
    const timer = window.setTimeout(
      () => {
        debounceTimerRef.current = null;
        setIsLoading(true);
        setLookupFailed(false);
        void (async () => {
          const repairRequest: Promise<RepairDeviceSummary[]> =
            repairCatalogEnabled
              ? apiGet<RepairDevicesResponse>(
                  `/api/storefront/${encodeURIComponent(merchantSlug)}/repairs/devices?q=${encodeURIComponent(query)}&mode=suggestions`,
                  { signal: controller.signal }
                ).then(({ groups }) =>
                  groups.flatMap((group) => group.devices).slice(0, 8)
                )
              : Promise.resolve([]);
          const productsRequest: Promise<{
            failed: boolean;
            products: StoreProductDeviceSuggestion[];
          }> = merchantId
            ? (async () => {
                const products: StoreProductDeviceSuggestion[] = [];
                let offset = 0;
                let pagesFetched = 0;
                let totalCount = Number.POSITIVE_INFINITY;

                try {
                  while (
                    products.length < MAX_REPAIR_DEVICE_SUGGESTIONS &&
                    pagesFetched < MAX_PRODUCT_SEARCH_PAGES &&
                    offset < totalCount
                  ) {
                    const response = await apiGet<{
                      count?: number;
                      products: StorefrontProductDeviceCandidate[];
                    }>(
                      `/api/storefront/products?merchant_id=${encodeURIComponent(merchantId)}&q=${encodeURIComponent(query)}&limit=${PRODUCT_SEARCH_PAGE_SIZE}&offset=${offset}&compact=true`,
                      { signal: controller.signal }
                    );
                    const pageProducts = response.products ?? [];
                    pagesFetched += 1;
                    const pageSuggestions = pageProducts
                      .map(toStoreProductSuggestion)
                      .filter(
                        (product): product is StoreProductDeviceSuggestion =>
                          product !== null
                      );
                    products.push(...pageSuggestions);
                    totalCount =
                      typeof response.count === 'number'
                        ? response.count
                        : offset + pageProducts.length;
                    if (pageProducts.length < PRODUCT_SEARCH_PAGE_SIZE) break;
                    offset += PRODUCT_SEARCH_PAGE_SIZE;
                  }
                  return { failed: false, products };
                } catch {
                  return { failed: true, products };
                }
              })()
            : Promise.resolve({ failed: false, products: [] });

          let repairDevices: RepairDeviceSummary[] = [];
          let repairLookupFailed = false;
          try {
            repairDevices = await repairRequest;
          } catch {
            if (controller.signal.aborted) return;
            repairLookupFailed = true;
          }

          if (controller.signal.aborted) return;
          if (repairDevices.length > 0) {
            controller.abort();
            setSuggestions(repairDevices);
            setHasSearched(true);
            setSettledQuery(query);
            setIsLoading(false);
            return;
          }

          const productsResult = await productsRequest;
          if (controller.signal.aborted) return;
          const storeSuggestions = productsResult.products.slice(
            0,
            MAX_REPAIR_DEVICE_SUGGESTIONS
          );
          setSuggestions(storeSuggestions);
          setHasSearched(true);
          setSettledQuery(query);
          setLookupFailed(repairLookupFailed || productsResult.failed);
          setIsLoading(false);
        })();
      },
      shouldRefreshImmediately ? 0 : 250
    );
    debounceTimerRef.current = timer;

    return () => {
      window.clearTimeout(timer);
      if (debounceTimerRef.current === timer) {
        debounceTimerRef.current = null;
      }
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
    refreshVersion,
    selectedModel,
  ]);

  const clearSuggestions = () => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;
    setSuggestions([]);
    setIsLoading(false);
    setHasSearched(false);
    setLookupFailed(false);
    setSettledQuery(null);
  };

  const refreshSuggestions = () => {
    if (!catalogEnabled || query.length < 2 || query === selectedModel) return;
    setRefreshVersion((version) => version + 1);
  };

  return {
    clearSuggestions,
    hasSearched: hasSearched && settledQuery === query,
    isLoading,
    lookupFailed: lookupFailed && settledQuery === query,
    refreshSuggestions,
    suggestions: settledQuery === query ? suggestions : [],
  };
}
