'use client';

import {
  type ImeiBrandFilter,
  type ImeiDeviceCategory,
  type ImeiIdentifierType,
  type ImeiServiceTierKey,
  isValidDeviceIdentifier,
} from '@baci/shared/imei';
import { Loader2, Sparkles } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef } from 'react';
import { ImeiCheckerBrandChips } from './imei-checker-brand-chips';
import { ImeiCheckerDeviceSearch } from './imei-checker-device-search';
import { ImeiCheckerDeviceTabs } from './imei-checker-device-tabs';
import { ImeiCheckerError } from './imei-checker-error';
import { ImeiCheckerFindImei } from './imei-checker-find-imei';
import { ImeiCheckerHero } from './imei-checker-hero';
import { ImeiCheckerIdentifierInput } from './imei-checker-identifier-input';
import { ImeiCheckerPending } from './imei-checker-pending';
import { IMEI_CHECKER_PROOF_ITEMS } from './imei-checker-proof-items';
import { ImeiCheckerTierSelector } from './imei-checker-tier-selector';
import { getDisplayTier } from './imei-checker-tiers';
import type { ProductSuggestion } from './imei-checker-types';

interface OgabasseyImeiEntryProps {
  brand: ImeiBrandFilter;
  canToggleServices: boolean;
  deviceQuery: string;
  device: ImeiDeviceCategory;
  displayedTierKeys: readonly ImeiServiceTierKey[];
  error: string | null;
  identifier: ImeiIdentifierType;
  imei: string;
  isLoading: boolean;
  isPending: boolean;
  needsWalletFunding: boolean;
  /** Set when the parent already committed the IMEI LCP hero. */
  omitHero?: boolean;
  onCheck: (event: React.FormEvent) => void;
  onDeviceQueryChange: (value: string) => void;
  onDeviceSearchFocus: () => void;
  onImeiChange: (value: string) => void;
  onSelectBrand: (brand: ImeiBrandFilter) => void;
  onSelectDevice: (device: ImeiDeviceCategory) => void;
  onSelectDeviceSuggestion: (device: ProductSuggestion) => void;
  onSelectTier: (tier: ImeiServiceTierKey) => void;
  onToggleServices: () => void;
  pendingPaused: boolean;
  searchLoading: boolean;
  selectedDeviceSuggestion: ProductSuggestion | null;
  selectedTier: ImeiServiceTierKey;
  showAllServices: boolean;
  showSuggestions: boolean;
  suggestions: ProductSuggestion[];
}

export const OgabasseyImeiEntry = ({
  brand,
  canToggleServices,
  device,
  deviceQuery,
  displayedTierKeys,
  error,
  identifier,
  imei,
  isLoading,
  isPending,
  needsWalletFunding,
  omitHero = false,
  onCheck,
  onDeviceQueryChange,
  onDeviceSearchFocus,
  onImeiChange,
  onSelectBrand,
  onSelectDevice,
  onSelectDeviceSuggestion,
  onSelectTier,
  onToggleServices,
  pendingPaused,
  searchLoading,
  selectedDeviceSuggestion,
  selectedTier,
  showSuggestions,
  showAllServices,
  suggestions,
}: OgabasseyImeiEntryProps) => {
  const currentTier = getDisplayTier(selectedTier);
  const canVerify = isValidDeviceIdentifier(imei, identifier);
  const rootRef = useRef<HTMLDivElement>(null);

  // Give this step a focus landing point on mount — covers both the initial
  // page load and remounting after "Check Another Device" resets `result`
  // (see imei-results.tsx, which unmounts and drops focus in the process).
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  return (
    <div className="outline-none" ref={rootRef} tabIndex={-1}>
      {omitHero ? null : <ImeiCheckerHero />}

      <ImeiCheckerDeviceSearch
        deviceQuery={deviceQuery}
        onDeviceQueryChange={onDeviceQueryChange}
        onDeviceSearchFocus={onDeviceSearchFocus}
        onSelectDevice={onSelectDeviceSuggestion}
        searchLoading={searchLoading}
        selectedDevice={selectedDeviceSuggestion}
        showSuggestions={showSuggestions}
        suggestions={suggestions}
      />

      <div className="mx-auto mb-8 max-w-4xl">
        <p className="mb-4 text-center text-sm font-medium text-gray-500">
          What are you checking?
        </p>
        <ImeiCheckerDeviceTabs onSelect={onSelectDevice} selected={device} />

        {device === 'smartphone' && (
          <div className="mt-4">
            <ImeiCheckerBrandChips
              onSelectBrand={onSelectBrand}
              selectedBrand={brand}
            />
          </div>
        )}

        <div className="mt-4">
          <ImeiCheckerTierSelector
            canToggleServices={canToggleServices}
            displayedTierKeys={displayedTierKeys}
            onSelectTier={onSelectTier}
            onToggleServices={onToggleServices}
            selectedTier={selectedTier}
            showAllServices={showAllServices}
          />
        </div>
      </div>

      <div className="mx-auto max-w-2xl">
        <div className="rounded-3xl border border-gray-100 bg-white p-3 shadow-xl shadow-gray-200/50 md:p-4">
          <form className="flex flex-col gap-3 md:flex-row" onSubmit={onCheck}>
            <ImeiCheckerIdentifierInput
              identifier={identifier}
              onChange={onImeiChange}
              value={imei}
            />
            <button
              aria-label={
                isLoading
                  ? 'Verifying'
                  : isPending
                    ? 'Checking device status'
                    : `Verify Now · ${currentTier.priceDisplay}`
              }
              className="flex items-center justify-center gap-2 whitespace-nowrap rounded-2xl bg-[var(--store-primary)] px-8 py-4 text-base font-bold text-[var(--store-primary-text,#ffffff)] shadow-lg shadow-[var(--store-primary)]/20 transition-all hover:bg-[var(--store-primary)]/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-70"
              disabled={isLoading || isPending || !canVerify}
              type="submit"
            >
              {isLoading || isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <>
                  Verify Now · {currentTier.priceDisplay}
                  <Sparkles size={18} />
                </>
              )}
            </button>
          </form>
        </div>
        {isPending ? <ImeiCheckerPending paused={pendingPaused} /> : null}
        {error ? (
          <ImeiCheckerError
            error={error}
            needsWalletFunding={needsWalletFunding}
          />
        ) : null}
        <ImeiCheckerFindImei />
      </div>

      <div className="mx-auto mt-16 max-w-4xl">
        <h2 className="mb-8 text-center text-xl font-bold text-gray-900">
          Why Smart Buyers Always Verify
        </h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {IMEI_CHECKER_PROOF_ITEMS.map(({ body, icon: Icon, title }) => (
            <div
              className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
              key={title}
            >
              <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-[var(--store-primary)]/5 text-[var(--store-primary)]">
                <Icon size={24} />
              </div>
              <h3 className="mb-2 font-bold text-gray-900">{title}</h3>
              <p className="text-sm text-gray-500">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
