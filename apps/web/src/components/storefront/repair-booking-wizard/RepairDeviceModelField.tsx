'use client';

import type { RepairDeviceSummary } from '@baci/shared/repairs';
import { useEffect, useState } from 'react';
import type { ControllerRenderProps } from 'react-hook-form';
import type { z } from 'zod';
import { Input } from '@/components/ui/input';
import { apiGet } from '@/lib/api-client';
import type { repairBookingSchema } from '@/lib/validations/repair';
import { RepairDeviceSuggestionImage } from './RepairDeviceSuggestionImage';
import {
  getRepairDeviceSuggestionLabel,
  type RepairDeviceSelection,
  type RepairDevicesResponse,
  type StorefrontProductDeviceCandidate,
  type StoreProductDeviceSuggestion,
  toStoreProductSuggestion,
} from './repair-device-suggestions';

const PRODUCT_SEARCH_CANDIDATE_LIMIT = 50;
const DEVICE_SUGGESTIONS_LISTBOX_ID = 'repair-device-suggestions';

interface RepairDeviceModelFieldProps {
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  catalogEnabled: boolean;
  repairCatalogEnabled?: boolean;
  field: ControllerRenderProps<
    z.input<typeof repairBookingSchema>,
    'deviceModel'
  >;
  id?: string;
  merchantId?: string;
  merchantSlug: string;
  onDeviceChange: () => void;
  onSelectDevice: (device: RepairDeviceSelection) => void;
}

export function RepairDeviceModelField({
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  catalogEnabled,
  repairCatalogEnabled = catalogEnabled,
  field,
  id,
  merchantId,
  merchantSlug,
  onDeviceChange,
  onSelectDevice,
}: RepairDeviceModelFieldProps) {
  const [suggestions, setSuggestions] = useState<RepairDeviceSelection[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [lookupFailed, setLookupFailed] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const query = field.value.trim();
  const showSearchResults =
    catalogEnabled && query.length >= 2 && (isLoading || hasSearched);
  const hasSuggestionOptions =
    showSearchResults && !isLoading && suggestions.length > 0;

  const selectSuggestion = (device: RepairDeviceSelection) => {
    setSelectedModel(getRepairDeviceSuggestionLabel(device));
    onSelectDevice(device);
    setSuggestions([]);
    setHasSearched(false);
    setLookupFailed(false);
    setActiveSuggestionIndex(-1);
  };

  useEffect(() => {
    if (!catalogEnabled || query.length < 2 || query === selectedModel) {
      setSuggestions([]);
      setHasSearched(false);
      setIsLoading(false);
      setLookupFailed(false);
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
          setIsLoading(false);
          return;
        }

        if (!merchantId) {
          setSuggestions([]);
          setHasSearched(true);
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
          setSuggestions(
            products
              .map(toStoreProductSuggestion)
              .filter(
                (product): product is StoreProductDeviceSuggestion =>
                  product !== null
              )
              .slice(0, 8)
          );
          setHasSearched(true);
          setLookupFailed(false);
        } catch {
          if (controller.signal.aborted) return;
          setSuggestions([]);
          setHasSearched(true);
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

  return (
    <div className="space-y-2">
      <Input
        {...field}
        aria-describedby={ariaDescribedBy}
        aria-activedescendant={
          activeSuggestionIndex >= 0 && hasSuggestionOptions
            ? `${DEVICE_SUGGESTIONS_LISTBOX_ID}-option-${activeSuggestionIndex}`
            : undefined
        }
        aria-autocomplete={catalogEnabled ? 'list' : undefined}
        aria-controls={
          hasSuggestionOptions ? DEVICE_SUGGESTIONS_LISTBOX_ID : undefined
        }
        aria-expanded={catalogEnabled ? hasSuggestionOptions : undefined}
        aria-invalid={ariaInvalid}
        autoComplete="off"
        id={id}
        onBlur={() => {
          field.onBlur();
        }}
        onChange={(event) => {
          setSelectedModel(null);
          setActiveSuggestionIndex(-1);
          field.onChange(event);
          onDeviceChange();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && showSearchResults) {
            event.preventDefault();
            setSuggestions([]);
            setHasSearched(false);
            setActiveSuggestionIndex(-1);
            return;
          }
          if (suggestions.length === 0) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveSuggestionIndex((current) =>
              current < suggestions.length - 1 ? current + 1 : 0
            );
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveSuggestionIndex((current) =>
              current > 0 ? current - 1 : suggestions.length - 1
            );
          } else if (event.key === 'Enter' && activeSuggestionIndex >= 0) {
            event.preventDefault();
            const selectedSuggestion = suggestions[activeSuggestionIndex];
            if (selectedSuggestion) selectSuggestion(selectedSuggestion);
          }
        }}
        placeholder="e.g. iPhone 13 Pro Max"
        role={catalogEnabled ? 'combobox' : undefined}
      />
      {showSearchResults && (
        <div className="space-y-2">
          {isLoading ? (
            <p
              className="rounded-md border px-3 py-2 text-sm text-muted-foreground"
              role="status"
            >
              Searching repair devices and store products…
            </p>
          ) : suggestions.length > 0 ? (
            <>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Choose a device
              </p>
              <div
                className="max-h-64 space-y-2 overflow-y-auto"
                aria-label="Device suggestions"
                id={DEVICE_SUGGESTIONS_LISTBOX_ID}
                role="listbox"
              >
                {suggestions.map((device, index) => {
                  const displayName = getRepairDeviceSuggestionLabel(device);
                  const isStoreProduct = 'kind' in device;
                  const suggestionKey = isStoreProduct
                    ? device.productId
                    : device.id;

                  return (
                    <button
                      aria-label={`${displayName} ${device.deviceType ?? ''}`.trim()}
                      aria-selected={activeSuggestionIndex === index}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border bg-background px-3 py-3 text-left text-sm transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      id={`${DEVICE_SUGGESTIONS_LISTBOX_ID}-option-${index}`}
                      key={suggestionKey}
                      onClick={() => selectSuggestion(device)}
                      onMouseEnter={() => setActiveSuggestionIndex(index)}
                      role="option"
                      type="button"
                    >
                      <RepairDeviceSuggestionImage
                        deviceType={device.deviceType}
                        imageUrl={device.imageUrl}
                        label={displayName}
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {displayName}
                        </span>
                        {device.deviceType && (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {device.deviceType}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs font-medium text-primary">
                        Select
                      </span>
                    </button>
                  );
                })}
              </div>
              {suggestions.some((device) => 'kind' in device) && (
                <p className="text-xs text-muted-foreground">
                  Store products fill in the device model; repair pricing may
                  need confirmation.
                </p>
              )}
            </>
          ) : (
            <p
              className="rounded-md border px-3 py-2 text-sm text-muted-foreground"
              role="status"
            >
              {lookupFailed
                ? 'Catalog suggestions are unavailable. You can still enter the model.'
                : 'No catalog match. You can continue with the model you entered.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
