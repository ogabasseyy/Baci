'use client';

import type {
  RepairDeviceSummary,
  RepairDeviceType,
} from '@baci/shared/repairs';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import type { ControllerRenderProps } from 'react-hook-form';
import type { z } from 'zod';
import { Input } from '@/components/ui/input';
import { apiGet } from '@/lib/api-client';
import type { repairBookingSchema } from '@/lib/validations/repair';
import {
  REPAIR_DEVICE_FALLBACK_ICON,
  REPAIR_DEVICE_TYPE_ICONS,
} from '../repairs/repair-device-icons';

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

interface RepairDevicesResponse {
  groups: Array<{ brand: string; devices: RepairDeviceSummary[] }>;
}

interface StorefrontProductsResponse {
  products: Array<{
    brand?: string | null;
    category?: string | null;
    id: string;
    image?: string | null;
    name: string;
  }>;
}

export interface StoreProductDeviceSuggestion {
  kind: 'store-product';
  productId: string;
  displayName: string;
  deviceType: RepairDeviceType;
  imageUrl: string | null;
}

export type RepairDeviceSelection =
  | RepairDeviceSummary
  | StoreProductDeviceSuggestion;

const DEVICE_CATEGORY_TYPES: ReadonlyArray<{
  pattern: RegExp;
  deviceType: RepairDeviceType;
}> = [
  {
    pattern: /\b(smartphones?|mobile phones?|cell phones?)\b/i,
    deviceType: 'Smartphone',
  },
  { pattern: /\b(laptops?|notebooks?)\b/i, deviceType: 'Laptop' },
  { pattern: /\b(tablets?|ipads?)\b/i, deviceType: 'Tablet' },
  {
    pattern: /\b(game consoles?|gaming consoles?)\b/i,
    deviceType: 'Console',
  },
  { pattern: /\bsmart\s?watches?\b/i, deviceType: 'Smartwatch' },
];

function toStoreProductSuggestion(
  product: StorefrontProductsResponse['products'][number]
): StoreProductDeviceSuggestion | null {
  const deviceType = DEVICE_CATEGORY_TYPES.find(({ pattern }) =>
    pattern.test(product.category ?? '')
  )?.deviceType;
  if (!deviceType) {
    return null;
  }

  const brand = product.brand?.trim();
  const name = product.name.trim();
  const displayName =
    brand && !name.toLowerCase().startsWith(brand.toLowerCase())
      ? `${brand} ${name}`
      : name;

  return {
    kind: 'store-product',
    productId: product.id,
    displayName,
    deviceType,
    imageUrl: product.image || null,
  };
}

function getSuggestionLabel(device: RepairDeviceSelection): string {
  return 'kind' in device
    ? device.displayName
    : `${device.brand} ${device.model}`.trim();
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
  const query = field.value.trim();
  const showSearchResults =
    catalogEnabled && query.length >= 2 && (isLoading || hasSearched);

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
          const { products } = await apiGet<StorefrontProductsResponse>(
            `/api/storefront/products?merchant_id=${encodeURIComponent(merchantId)}&q=${encodeURIComponent(query)}&limit=8&compact=true&has_images=true`,
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
        aria-invalid={ariaInvalid}
        autoComplete="off"
        id={id}
        onBlur={() => {
          field.onBlur();
        }}
        onChange={(event) => {
          setSelectedModel(null);
          field.onChange(event);
          onDeviceChange();
        }}
        placeholder="e.g. iPhone 13 Pro Max"
        role={catalogEnabled ? 'searchbox' : undefined}
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
              <ul className="max-h-64 space-y-2 overflow-y-auto">
                {suggestions.map((device) => {
                  const displayName = getSuggestionLabel(device);
                  const isStoreProduct = 'kind' in device;
                  const suggestionKey = isStoreProduct
                    ? device.productId
                    : device.id;

                  return (
                    <li key={suggestionKey}>
                      <button
                        aria-label={`${displayName} ${device.deviceType ?? ''}`.trim()}
                        className="flex w-full items-center justify-between gap-3 rounded-lg border bg-background px-3 py-3 text-left text-sm transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => {
                          setSelectedModel(displayName);
                          onSelectDevice(device);
                          setSuggestions([]);
                          setHasSearched(false);
                          setLookupFailed(false);
                        }}
                        type="button"
                      >
                        <DeviceSuggestionImage
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
                    </li>
                  );
                })}
              </ul>
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

function DeviceSuggestionImage({
  deviceType,
  imageUrl,
  label,
}: {
  deviceType: RepairDeviceType | null;
  imageUrl: string | null;
  label: string;
}) {
  const [hasLoadError, setHasLoadError] = useState(false);
  const Icon =
    (deviceType && REPAIR_DEVICE_TYPE_ICONS[deviceType]) ||
    REPAIR_DEVICE_FALLBACK_ICON;

  return (
    <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
      {imageUrl && !hasLoadError ? (
        <Image
          alt={label}
          className="size-12 object-contain"
          height={48}
          onError={() => setHasLoadError(true)}
          src={imageUrl}
          width={48}
        />
      ) : (
        <Icon aria-hidden="true" size={20} />
      )}
    </span>
  );
}
