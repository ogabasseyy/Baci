'use client';

import { useEffect, useState } from 'react';
import type { ControllerRenderProps } from 'react-hook-form';
import type { z } from 'zod';
import { Input } from '@/components/ui/input';
import type { repairBookingSchema } from '@/lib/validations/repair';
import { RepairDeviceSuggestionImage } from './RepairDeviceSuggestionImage';
import { getRepairDeviceSuggestionLabel } from './repair-device-suggestion-label';
import type { RepairDeviceSelection } from './repair-device-suggestions';
import { useRepairDeviceSuggestions } from './useRepairDeviceSuggestions';

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
  selectedModel?: string | null;
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
  selectedModel = null,
}: RepairDeviceModelFieldProps) {
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const query = field.value.trim();
  const {
    clearSuggestions,
    hasSearched,
    isLoading,
    lookupFailed,
    suggestions,
  } = useRepairDeviceSuggestions({
    catalogEnabled,
    merchantId,
    merchantSlug,
    query,
    repairCatalogEnabled,
    selectedModel,
  });
  const showSearchResults =
    catalogEnabled && query.length >= 2 && (isLoading || hasSearched);
  const hasSuggestionOptions =
    showSearchResults && !isLoading && suggestions.length > 0;

  const selectSuggestion = (device: RepairDeviceSelection) => {
    onSelectDevice(device);
    clearSuggestions();
    setActiveSuggestionIndex(-1);
  };

  useEffect(() => {
    if (activeSuggestionIndex < 0 || !hasSuggestionOptions) return;
    document
      .getElementById(
        `${DEVICE_SUGGESTIONS_LISTBOX_ID}-option-${activeSuggestionIndex}`
      )
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeSuggestionIndex, hasSuggestionOptions]);

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
          setActiveSuggestionIndex(-1);
          field.onChange(event);
          onDeviceChange();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && showSearchResults) {
            event.preventDefault();
            clearSuggestions();
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
                      className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-3 text-left text-sm transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        activeSuggestionIndex === index
                          ? 'border-primary/50 bg-accent'
                          : 'bg-background'
                      }`}
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
