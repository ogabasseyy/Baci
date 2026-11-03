'use client';

import type React from 'react';
import { useEffect, useState } from 'react';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { fetchDeviceSuggestions } from './fetch-imei-device-suggestions';
import { OgabasseyImeiEntry } from './imei-checker-entry';
import { OgabasseyImeiCheckerShell } from './imei-checker-shell';
import type { ProductSuggestion } from './imei-checker-types';
import { OgabasseyImeiResults } from './imei-results';
import { useImeiCheckRequest } from './use-imei-check-request';
import { useImeiTierSelection } from './use-imei-tier-selection';

interface OgabasseyImeiCheckerProps {
  /** Set when the parent already committed the IMEI LCP hero. */
  omitHero?: boolean;
  /** Set when the parent already owns the page chrome around this island. */
  omitShell?: boolean;
}

export const OgabasseyImeiChecker: React.FC<OgabasseyImeiCheckerProps> = ({
  omitHero = false,
  omitShell = false,
}) => {
  const merchantSlug = useMerchantSafe()?.merchant?.slug;
  const {
    availabilityFailed,
    availabilityLoading,
    retryAvailability,
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
    onSelectTier,
    onToggleServices,
  } = useImeiTierSelection();

  const {
    error,
    isLoading,
    needsSignIn,
    needsWalletFunding,
    pendingLookup,
    result,
    resultDevice,
    resultLookupId,
    resultTier,
    runCheck,
    reset,
  } = useImeiCheckRequest(merchantSlug);

  // Device search autocomplete state
  const [deviceQuery, setDeviceQuery] = useState('');
  const [suggestions, setSuggestions] = useState<ProductSuggestion[]>([]);
  const [selectedDeviceSuggestion, setSelectedDeviceSuggestion] =
    useState<ProductSuggestion | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);

  // Debounced search for product suggestions. Suggestions are cleared in the
  // query change handler, so this effect only syncs with the external API.
  useEffect(() => {
    if (deviceQuery.length < 2) {
      return;
    }

    const timer = setTimeout(async () => {
      setSearchLoading(true);
      const fetched = await fetchDeviceSuggestions(deviceQuery);
      if (fetched) {
        setSuggestions(fetched);
      }
      setSearchLoading(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [deviceQuery]);

  const handleSelectDeviceSuggestion = (suggestion: ProductSuggestion) => {
    setSelectedDeviceSuggestion(suggestion);
    setDeviceQuery(suggestion.name);
    setShowSuggestions(false);
  };

  const handleCheck = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedTier || !displayedTierKeys.includes(selectedTier)) return;
    void runCheck(selectedTier, imei, device);
  };

  const body = (
    <>
      {!result && (
        <OgabasseyImeiEntry
          availabilityFailed={availabilityFailed}
          availabilityLoading={availabilityLoading}
          onRetryAvailability={retryAvailability}
          brand={brand}
          canToggleServices={canToggleServices}
          device={device}
          deviceQuery={deviceQuery}
          displayedTierKeys={displayedTierKeys}
          error={error}
          identifier={identifier}
          imei={imei}
          isLoading={isLoading}
          isPending={pendingLookup.pending !== null}
          needsSignIn={needsSignIn}
          needsWalletFunding={needsWalletFunding}
          omitHero={omitHero}
          onCheck={handleCheck}
          onDeviceQueryChange={(value) => {
            setDeviceQuery(value);
            setShowSuggestions(true);
            if (!value) setSelectedDeviceSuggestion(null);
            if (value.length < 2) setSuggestions([]);
          }}
          onDeviceSearchFocus={() => setShowSuggestions(true)}
          onImeiChange={onChangeImei}
          onSelectBrand={onSelectBrand}
          onSelectDevice={onSelectDevice}
          onSelectDeviceSuggestion={handleSelectDeviceSuggestion}
          onSelectTier={onSelectTier}
          onToggleServices={onToggleServices}
          pendingPaused={pendingLookup.paused}
          pendingCanResume={pendingLookup.canResume}
          searchLoading={searchLoading}
          selectedDeviceSuggestion={selectedDeviceSuggestion}
          selectedTier={selectedTier}
          showAllServices={showAllServices}
          showSuggestions={showSuggestions}
          suggestions={suggestions}
        />
      )}

      <OgabasseyImeiResults
        currentTier={resultTier ?? currentTier}
        onReset={() => {
          reset();
          onClearImei();
        }}
        onCheckBlacklist={
          result && resultDevice === 'smartphone'
            ? () => {
                void runCheck('blacklist', result.imei, resultDevice, true);
              }
            : undefined
        }
        isChecking={isLoading || pendingLookup.pending !== null}
        pendingPaused={pendingLookup.paused}
        pendingCanResume={pendingLookup.canResume}
        checkError={error}
        needsSignIn={needsSignIn}
        needsWalletFunding={needsWalletFunding}
        lookupId={resultLookupId}
        result={result}
      />
    </>
  );

  return (
    <OgabasseyImeiCheckerShell omitShell={omitShell}>
      {body}
    </OgabasseyImeiCheckerShell>
  );
};
