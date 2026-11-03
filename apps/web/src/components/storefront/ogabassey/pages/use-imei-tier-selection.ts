'use client';

import {
  IMEI_IDENTIFIER_BY_DEVICE,
  IMEI_SERVICE_TIERS,
  type ImeiBrandFilter,
  type ImeiDeviceCategory,
  type ImeiServiceTierKey,
  normalizeDeviceIdentifier,
  RECOMMENDED_TIER_BY_DEVICE,
  resolveInputIdentifier,
} from '@baci/shared/imei';
import { useEffect, useState } from 'react';
import {
  getVisibleWebImeiServiceTierKeys,
  hasAdditionalWebImeiServiceTierKeys,
} from './imei-checker-visible-tiers';
import { useImeiRuntimeAvailability } from './use-imei-runtime-availability';

const DEFAULT_BRAND: ImeiBrandFilter = 'apple';

export interface UseImeiTierSelectionResult {
  brand: ImeiBrandFilter;
  canToggleServices: boolean;
  currentTier: (typeof IMEI_SERVICE_TIERS)[ImeiServiceTierKey];
  device: ImeiDeviceCategory;
  displayedTierKeys: ImeiServiceTierKey[];
  identifier: ReturnType<typeof resolveInputIdentifier>;
  imei: string;
  selectedTier: ImeiServiceTierKey | null;
  availabilityFailed: boolean;
  availabilityLoading: boolean;
  retryAvailability: () => void;
  showAllServices: boolean;
  onChangeImei: (raw: string) => void;
  onClearImei: () => void;
  onSelectBrand: (brand: ImeiBrandFilter) => void;
  onSelectDevice: (device: ImeiDeviceCategory) => void;
  onSelectTier: (tier: ImeiServiceTierKey) => void;
  onToggleServices: () => void;
}

/**
 * Owns device/brand/tier/identifier-input selection for the web IMEI checker
 * — the web equivalent of mobile's ImeiCheckDevicePage local state, adapted
 * for a single-page (no swipeable-pager) UI: switching device tabs resets
 * tier/brand/imei to that device's defaults rather than persisting separate
 * state per tab (mobile keeps each tab's page mounted; web has no such
 * multi-instance lifecycle to piggyback on).
 */
export function useImeiTierSelection(): UseImeiTierSelectionResult {
  const [device, setDevice] = useState<ImeiDeviceCategory>('smartphone');
  const [brand, setBrand] = useState<ImeiBrandFilter>(DEFAULT_BRAND);
  const [selectedTierKey, setSelectedTier] =
    useState<ImeiServiceTierKey | null>(RECOMMENDED_TIER_BY_DEVICE.smartphone);
  const [showAllServices, setShowAllServices] = useState(false);
  const [imei, setImei] = useState('');

  const availability = useImeiRuntimeAvailability(device);
  const currentTier =
    IMEI_SERVICE_TIERS[selectedTierKey ?? RECOMMENDED_TIER_BY_DEVICE[device]];
  const identifier = resolveInputIdentifier(
    currentTier.identifier,
    IMEI_IDENTIFIER_BY_DEVICE[device]
  );

  const expanded = showAllServices;
  const displayedTierKeys = getVisibleWebImeiServiceTierKeys(
    device,
    brand,
    expanded,
    availability.availableTierKeys
  );
  const selectedTier =
    selectedTierKey && displayedTierKeys.includes(selectedTierKey)
      ? selectedTierKey
      : null;
  const canToggleServices = hasAdditionalWebImeiServiceTierKeys(
    device,
    brand,
    availability.availableTierKeys
  );
  useEffect(() => {
    if (selectedTierKey && !displayedTierKeys.includes(selectedTierKey))
      setSelectedTier(null);
  }, [displayedTierKeys, selectedTierKey]);

  function applyTier(
    nextTierKey: ImeiServiceTierKey | null,
    forDevice = device
  ) {
    if (!nextTierKey) {
      setSelectedTier(null);
      return;
    }
    const nextIdentifier = resolveInputIdentifier(
      IMEI_SERVICE_TIERS[nextTierKey].identifier,
      IMEI_IDENTIFIER_BY_DEVICE[forDevice]
    );
    if (nextIdentifier !== identifier) {
      setImei('');
    }
    setSelectedTier(nextTierKey);
  }

  function onSelectDevice(nextDevice: ImeiDeviceCategory) {
    setDevice(nextDevice);
    setBrand(DEFAULT_BRAND);
    setShowAllServices(false);
    setImei('');
    setSelectedTier(RECOMMENDED_TIER_BY_DEVICE[nextDevice]);
  }

  function onSelectBrand(nextBrand: ImeiBrandFilter) {
    setBrand(nextBrand);
    const nextVisible = getVisibleWebImeiServiceTierKeys(
      device,
      nextBrand,
      showAllServices,
      availability.availableTierKeys
    );
    if (!selectedTier || !nextVisible.includes(selectedTier)) {
      applyTier(nextVisible[0] ?? null);
    }
  }

  function onToggleServices() {
    const nextExpanded = !showAllServices;
    setShowAllServices(nextExpanded);
    const nextVisible = getVisibleWebImeiServiceTierKeys(
      device,
      brand,
      nextExpanded,
      availability.availableTierKeys
    );
    if (!selectedTier || !nextVisible.includes(selectedTier)) {
      applyTier(nextVisible[0] ?? null);
    }
  }

  function onChangeImei(raw: string) {
    setImei(normalizeDeviceIdentifier(raw, identifier));
  }

  function onClearImei() {
    setImei('');
  }

  return {
    availabilityFailed: availability.failed,
    availabilityLoading: availability.loading,
    retryAvailability: availability.retry,
    brand,
    canToggleServices,
    currentTier,
    device,
    displayedTierKeys,
    identifier,
    imei,
    selectedTier,
    showAllServices,
    onChangeImei,
    onClearImei,
    onSelectBrand,
    onSelectDevice,
    onSelectTier: (tier) => {
      if (displayedTierKeys.includes(tier)) applyTier(tier);
    },
    onToggleServices,
  };
}
