'use client';

import type { ImeiServiceTierDefinition } from '@baci/shared/imei';
import {
  canAssessImeiNetworkUnlock,
  getImeiBlacklistState,
  getImeiEffectiveVerdict,
  isValidDeviceIdentifier,
} from '@baci/shared/imei';
import { ScanBarcode, Smartphone } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import { ImeiCheckerError } from './imei-checker-error';
import { ImeiCheckerPending } from './imei-checker-pending';
import { ImeiCheckerStatusCard } from './imei-checker-status-card';
import { getImeiResultStatusCards } from './imei-checker-status-cards';
import { getDisplayTier } from './imei-checker-tiers';
import { getVerdictTone } from './imei-checker-tone';
import type { ImeiResult } from './imei-checker-types';
import { ImeiRemediationOffer } from './imei-remediation-offer';

interface OgabasseyImeiResultsProps {
  currentTier: ImeiServiceTierDefinition;
  lookupId?: string | null;
  result: ImeiResult | null;
  onReset: () => void;
  onCheckBlacklist?: () => void;
  isChecking?: boolean;
  pendingPaused?: boolean;
  checkError?: string | null;
  needsSignIn?: boolean;
  needsWalletFunding?: boolean;
}

export function OgabasseyImeiResults({
  currentTier,
  lookupId,
  result,
  onReset,
  onCheckBlacklist,
  isChecking = false,
  pendingPaused = false,
  checkError,
  needsSignIn = false,
  needsWalletFunding = false,
}: OgabasseyImeiResultsProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Move focus onto the report when it appears — the entry form (including
  // the just-focused submit button) unmounts the moment a result is ready,
  // so without this the browser silently drops focus to <body>.
  useEffect(() => {
    if (result) {
      rootRef.current?.focus();
    }
  }, [result]);

  if (!result) {
    return null;
  }

  const effectiveVerdict = getImeiEffectiveVerdict(result);
  const headerTone = getVerdictTone(effectiveVerdict.type);
  const verdictTone = headerTone;
  const canCheckBlacklist =
    onCheckBlacklist &&
    !currentTier.checksIncluded.includes('blacklistStatus') &&
    isValidDeviceIdentifier(result.imei, 'imei') &&
    getImeiBlacklistState(result.blacklistStatus) === 'unknown';
  const statusCards = getImeiResultStatusCards(
    result,
    currentTier.checksIncluded
  );

  return (
    <div
      className="mx-auto mb-16 max-w-2xl animate-in slide-in-from-bottom-8 duration-700 outline-none"
      data-imei-result=""
      ref={rootRef}
      tabIndex={-1}
    >
      <p aria-live="polite" className="sr-only" role="status">
        {currentTier.name} report ready for {result.device}:{' '}
        {effectiveVerdict.text}
      </p>
      <div className="overflow-hidden rounded-3xl border border-[var(--store-border,#f3f4f6)] bg-[var(--store-surface,#ffffff)] shadow-xl">
        <div className={`p-6 md:p-8 ${headerTone.surface}`}>
          <div className="flex flex-col items-center gap-6 md:flex-row">
            <div className="relative size-28 shrink-0 rounded-2xl border border-[var(--store-border,#f3f4f6)] bg-[var(--store-surface,#ffffff)] p-2 shadow-sm">
              {result.deviceImage ? (
                <CdnFormatImage
                  alt={result.device}
                  className="object-contain p-2"
                  fill
                  sizes="112px"
                  src={result.deviceImage}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[var(--store-icon-muted,#d1d5db)]">
                  <Smartphone size={48} />
                </div>
              )}
            </div>

            <div className="flex-1 text-center md:text-left">
              <div className="mb-2 flex items-center justify-center gap-2 md:justify-start">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--store-muted-text,#6b7280)]">
                  {currentTier.name} Report
                </span>
                <span className="text-[var(--store-icon-muted,#d1d5db)]">
                  •
                </span>
              </div>
              <h2 className="text-xl font-bold text-[var(--store-text,#111827)] md:text-2xl">
                {result.deviceProfile?.model ?? result.device}
              </h2>
              {result.deviceProfile && (
                <>
                  {(result.deviceProfile.color ||
                    result.deviceProfile.storage) && (
                    <p className="mt-1 text-sm text-store-foreground">
                      {[
                        result.deviceProfile.color,
                        result.deviceProfile.storage,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                  {result.deviceProfile.imageMatch !== 'none' && (
                    <p className="mt-1 text-xs text-store-foreground">
                      {result.deviceProfile.imageMatch === 'color' &&
                      result.deviceProfile.color
                        ? `Catalog illustration · ${result.deviceProfile.color}`
                        : 'Model illustration · colour may differ'}
                    </p>
                  )}
                </>
              )}
              <p className="mt-1 font-mono text-sm text-[var(--store-muted-text,#6b7280)]">
                IMEI: {result.imei}
              </p>
              {result.modelNumber ? (
                <p className="mt-0.5 text-xs text-[var(--store-muted-text,#9ca3af)]">
                  Model: {result.modelNumber}
                </p>
              ) : null}
            </div>

            <div
              className={`flex min-w-[100px] flex-col items-center justify-center rounded-xl border bg-[var(--store-surface,#ffffff)] px-4 py-2 ${headerTone.border}`}
            >
              <span className={`text-2xl font-black ${headerTone.text}`}>
                {result.score}%
              </span>
              <span className="text-[10px] font-bold uppercase text-[var(--store-muted-text,#9ca3af)]">
                Trust Score
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-2 md:p-8">
          {statusCards.map((card) => (
            <ImeiCheckerStatusCard key={card.label} {...card} />
          ))}
        </div>

        <div
          className={`border-t p-6 text-center ${verdictTone.surface} ${verdictTone.border}`}
        >
          <p
            className={`text-base font-bold leading-relaxed ${verdictTone.text}`}
          >
            {effectiveVerdict.text}
          </p>
          {canCheckBlacklist ? (
            <button
              className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--store-primary)] px-5 py-3 text-sm font-bold text-[var(--store-primary-text,#ffffff)] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isChecking}
              onClick={onCheckBlacklist}
              type="button"
            >
              {isChecking
                ? 'Checking blacklist…'
                : `Check blacklist status · ${getDisplayTier('blacklist').priceDisplay}`}
            </button>
          ) : null}
        </div>
      </div>

      {isChecking ? <ImeiCheckerPending paused={pendingPaused} /> : null}
      {checkError ? (
        <ImeiCheckerError
          error={checkError}
          needsSignIn={needsSignIn}
          needsWalletFunding={needsWalletFunding}
        />
      ) : null}

      {lookupId && canAssessImeiNetworkUnlock(result) ? (
        <ImeiRemediationOffer identifier={result.imei} lookupId={lookupId} />
      ) : null}

      <div className="mt-8 text-center">
        <button
          className="inline-flex items-center gap-2 text-sm font-bold text-[var(--store-muted-text,#6b7280)] hover:text-[var(--store-text,#111827)]"
          onClick={onReset}
          disabled={isChecking}
          type="button"
        >
          <ScanBarcode size={16} />
          Check Another Device
        </button>
      </div>
    </div>
  );
}
