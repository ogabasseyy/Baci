'use client';

import type { RepairDeviceSummary } from '@baci/shared/repairs';
import { useEffect, useState } from 'react';
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
    const timer = window.setTimeout(() => {
      setIsLoading(true);
      setLookupFailed(false);
      void (async () => {
        let repairDevices: RepairDeviceSummary[] = [];
        let repairLookupFailed = false;

        if (repairCatalogEnabled) {
          try {
            const { groups } = await apiGet<RepairDevicesResponse>(
              `/api/storefront/${encodeURIComponent(merchantSlug)}/repairs/devices?q=${encodeURIComponent(query)}`,
              { signal: controller.signal }
            );
            repairDevices = groups
              .flatMap((group) => group.devices)
              .slice(0, 8);
          } catch {
            if (controller.signal.aborted) return;
            repairLookupFailed = true;
          }
        }

        if (controller.signal.aborted) return;
        if (repairDevices.length > 0) {
          setSuggestions(repairDevices);
          setHasSearched(true);
          setSettledQuery(query);
          setIsLoading(false);
          return;
        }

        if (!merchantId) {
          setSuggestions([]);
          setHasSearched(true);
          setSettledQuery(query);
          setIsLoading(false);
          setLookupFailed(repairLookupFailed);
          return;
        }

        try {
          const { products } = await apiGet<{
            products: StorefrontProductDeviceCandidate[];
          }>(
            `/api/storefront/products?merchant_id=${encodeURIComponent(merchantId)}&q=${encodeURIComponent(query)}&limit=${PRODUCT_SEARCH_CANDIDATE_LIMIT}&compact=true`,
            { signal: controller.signal }
          );
          if (controller.signal.aborted) return;
          const storeSuggestions = products
            .map(toStoreProductSuggestion)
            .filter(
              (product): product is StoreProductDeviceSuggestion =>
                product !== null
            )
            .slice(0, 8);
          setSuggestions(storeSuggestions);
          setHasSearched(true);
          setSettledQuery(query);
          setLookupFailed(repairLookupFailed && storeSuggestions.length === 0);
        } catch {
          if (controller.signal.aborted) return;
          setSuggestions([]);
          setHasSearched(true);
          setSettledQuery(query);
          setLookupFailed(true);
        } finally {
          if (!controller.signal.aborted) setIsLoading(false);
        }
      })();
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
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
    setSuggestions([]);
    setHasSearched(false);
    setLookupFailed(false);
  };

  return {
    clearSuggestions,
    hasSearched: hasSearched && settledQuery === query,
    isLoading,
    lookupFailed: lookupFailed && settledQuery === query,
    suggestions: settledQuery === query ? suggestions : [],
  };
}
