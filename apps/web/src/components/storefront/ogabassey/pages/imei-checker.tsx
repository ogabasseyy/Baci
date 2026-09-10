'use client';

import {
  IMEI_SERVICE_TIERS,
  type ImeiServiceTierDefinition,
  isValidDeviceIdentifier,
} from '@baci/shared/imei';
import type React from 'react';
import { useEffect, useState } from 'react';
import { useOptionalCustomerAuth } from '@/contexts/customer-auth-context';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { OgabasseyImeiEntry } from './imei-checker-entry';
import { performImeiCheck } from './imei-checker-request';
import { OgabasseyImeiCheckerShell } from './imei-checker-shell';
import type {
  ImeiRequestIdentity,
  ImeiResult,
  ProductSuggestion,
} from './imei-checker-types';
import { OgabasseyImeiResults } from './imei-results';
import { useImeiPendingLookup } from './use-imei-pending-lookup';
import { useImeiTierSelection } from './use-imei-tier-selection';

const createFallbackUuid = () => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const createIdempotencyKey = () => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Secure crypto unavailable');
  }

  return createFallbackUuid();
};

/**
 * Module-scope fetch keeps the try/finally clause out of the component body
 * so React Compiler can memoize the checker.
 */
async function fetchDeviceSuggestions(
  query: string
): Promise<ProductSuggestion[] | null> {
  try {
    const response = await fetch(
      `/api/storefront/products?q=${encodeURIComponent(query)}&limit=5`
    );
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return (
      data.data?.map((p: Record<string, unknown>) => ({
        id: p.id as string,
        name: p.name as string,
        category: p.category as string | undefined,
        image: p.image as string | undefined,
      })) || []
    );
  } catch {
    console.warn('Failed to fetch device suggestions');
    return null;
  }
}

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
  const customerAuth = useOptionalCustomerAuth();
  const merchantSlug = useMerchantSafe()?.merchant?.slug;
  const {
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

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsWalletFunding, setNeedsWalletFunding] = useState(false);
  const [result, setResult] = useState<ImeiResult | null>(null);
  const [resultLookupId, setResultLookupId] = useState<string | null>(null);
  // Snapshot of the tier that actually produced `result`, frozen at request
  // time — the picker's live `currentTier` can change (device/brand/tier
  // switches stay interactive while a check is in flight) before the
  // response arrives, and rendering against the live value would mislabel
  // a completed, paid-for result.
  const [resultTier, setResultTier] =
    useState<ImeiServiceTierDefinition | null>(null);
  const [requestIdentity, setRequestIdentity] =
    useState<ImeiRequestIdentity | null>(null);
  const pendingLookup = useImeiPendingLookup({
    customerId: customerAuth?.customer?.id,
    merchantSlug,
  });

  useEffect(() => {
    const terminal = pendingLookup.terminal;
    if (!terminal) return;

    setRequestIdentity(null);
    setIsLoading(false);
    if (terminal.kind === 'complete') {
      setError(null);
      setResult(terminal.result);
      setResultLookupId(terminal.lookupId);
      setResultTier(IMEI_SERVICE_TIERS[terminal.tier]);
    } else {
      setError(terminal.error);
    }
    pendingLookup.clearTerminal();
  }, [pendingLookup]);

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

  const handleCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidDeviceIdentifier(imei, identifier)) return;
    if (!merchantSlug) {
      setError('This storefront is unavailable. Refresh and try again.');
      setNeedsWalletFunding(false);
      return;
    }

    setIsLoading(true);
    setResult(null);
    setError(null);
    setNeedsWalletFunding(false);

    const normalizedImei = imei.trim();
    const existingIdentityMatches =
      requestIdentity?.imei === normalizedImei &&
      requestIdentity.tier === selectedTier;

    let idempotencyKey: string;
    try {
      idempotencyKey = existingIdentityMatches
        ? requestIdentity.key
        : createIdempotencyKey();
    } catch (err) {
      console.error('IMEI check failed:', err);
      setError('Network error. Please check your connection and try again.');
      setNeedsWalletFunding(false);
      setIsLoading(false);
      return;
    }

    if (idempotencyKey !== requestIdentity?.key) {
      setRequestIdentity({
        imei: normalizedImei,
        tier: selectedTier,
        key: idempotencyKey,
      });
    }

    const outcome = await performImeiCheck(
      normalizedImei,
      selectedTier,
      currentTier.price,
      idempotencyKey,
      merchantSlug,
      device
    );

    if (!outcome.keepRequestIdentity) {
      setRequestIdentity(null);
    }

    if (outcome.pending) {
      pendingLookup.start({
        lookupId: outcome.pending.lookupId,
        pollAfterMs: outcome.pending.pollAfterMs,
        tier: selectedTier,
      });
    } else if (outcome.error !== null) {
      setError(outcome.error);
    } else {
      setResult(outcome.result);
      setResultLookupId(outcome.lookupId);
      // `currentTier` here is the value closed over at submit time, not the
      // hook's live value at response time — exactly the snapshot needed.
      setResultTier(currentTier);
    }
    setNeedsWalletFunding(outcome.needsWalletFunding);
    setIsLoading(false);
  };

  const body = (
    <>
        {!result && (
          <OgabasseyImeiEntry
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
            pendingLookup.clear();
            setResult(null);
            setResultLookupId(null);
            setResultTier(null);
            setError(null);
            setNeedsWalletFunding(false);
            onClearImei();
          }}
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
