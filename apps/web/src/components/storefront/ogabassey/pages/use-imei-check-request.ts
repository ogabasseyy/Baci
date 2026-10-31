'use client';

import {
  IMEI_SERVICE_TIERS,
  IMEI_IDENTIFIER_BY_DEVICE,
  normalizeDeviceIdentifier,
  resolveInputIdentifier,
  type ImeiDeviceCategory,
  type ImeiReport,
  type ImeiServiceTierDefinition,
  type ImeiServiceTierKey,
  isValidDeviceIdentifier,
} from '@baci/shared/imei';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useOptionalCustomerAuth } from '@/contexts/customer-auth-context';
import { createImeiIdempotencyKey } from './imei-checker-idempotency-key';
import { acquireImeiRecoveryKey, clearImeiRecoveryKey } from './imei-request-recovery';
import { performImeiCheck } from './imei-checker-request';
import type { ImeiResult } from './imei-checker-types';
import { useImeiPendingLookup } from './use-imei-pending-lookup';

export function useImeiCheckRequest(merchantSlug?: string) {
  const customerAuth = useOptionalCustomerAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
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
  const requestScope = `${merchantSlug ?? ''}:${customerAuth?.customer?.id ?? 'anonymous'}:${customerAuth?.user?.id ?? ''}`;
  const submitting = useRef(false);
  const lastSeen = useRef(new Map<string, string>());
  const [resultScope, setResultScope] = useState('');
  const activeScope = useRef(requestScope);
  useLayoutEffect(() => {
    activeScope.current = requestScope;
    setResult(null);
    setResultLookupId(null);
    setError(null);
  }, [requestScope]);
  const [resultDevice, setResultDevice] = useState<ImeiDeviceCategory | null>(
    null
  );
  const pendingLookup = useImeiPendingLookup({
    customerId: customerAuth?.customer?.id,
    userId: customerAuth?.user?.id,
    merchantSlug,
  });

  useEffect(() => {
    const terminal = pendingLookup.terminal;
    if (!terminal) return;

    if ((terminal.kind === 'complete' || terminal.confirmedRefund === true) && terminal.recovery) {
      void clearImeiRecoveryKey(terminal.recovery.storageKey, terminal.recovery.idempotencyKey).catch(() => undefined);
    }
    submitting.current = false;
    setIsLoading(false);
    if (terminal.kind === 'complete') {
      setError(null);
      setResultScope(requestScope);
      setResult(terminal.result);
      setResultLookupId(terminal.lookupId);
      if (terminal.lookupId) lastSeen.current.set(JSON.stringify([requestScope, terminal.tier, terminal.result.imei.trim().toUpperCase()]), terminal.lookupId);
      setResultTier(IMEI_SERVICE_TIERS[terminal.tier]);
      const categories = IMEI_SERVICE_TIERS[terminal.tier].deviceCategories;
      // Old saved lookups have no device. Infer only an unambiguous tier;
      // an IMEI alone does not distinguish a phone from a cellular tablet.
      setResultDevice(
        terminal.device ?? (categories.length === 1 ? categories[0] : null)
      );
    } else {
      setError(terminal.error);
    }
    pendingLookup.clearTerminal();
  }, [pendingLookup, requestScope]);

  const runCheck = async (
    tier: ImeiServiceTierKey,
    imei: string,
    device: ImeiDeviceCategory,
    preserveResult = false
  ) => {
    if (submitting.current || pendingLookup.pending) return;
    const currentTier = IMEI_SERVICE_TIERS[tier];
    if (!isValidDeviceIdentifier(imei, currentTier.identifier)) return;
    const selectedTier = tier;
    if (!merchantSlug) {
      setNeedsSignIn(false);
      setError('This storefront is unavailable. Refresh and try again.');
      setNeedsWalletFunding(false);
      return;
    }

    if (!customerAuth?.user?.id || !customerAuth.customer?.id) {
      setNeedsSignIn(!customerAuth?.isLoading);
      setError(customerAuth?.isLoading ? 'Loading your account. Please try again.' : 'Please sign in to check this device.');
      return;
    }
    setNeedsSignIn(false);
    submitting.current = true;
    setIsLoading(true);
    setResultDevice(device);
    if (!preserveResult) setResult(null);
    setError(null);
    setNeedsWalletFunding(false);

    try {
      const normalizedImei = normalizeDeviceIdentifier(imei, resolveInputIdentifier(currentTier.identifier, IMEI_IDENTIFIER_BY_DEVICE[device]));
      let recovery: Awaited<ReturnType<typeof acquireImeiRecoveryKey>>;
      try {
        recovery = await acquireImeiRecoveryKey([requestScope, selectedTier, normalizedImei], createImeiIdempotencyKey);
      } catch {
        if (activeScope.current !== requestScope) return;
        setError('Your browser cannot safely resume this check. Enable storage or try a current browser.');
        return;
      }
      if (activeScope.current !== requestScope) return;
      const { idempotencyKey } = recovery;

      const outcome = await performImeiCheck(
        normalizedImei,
        selectedTier,
        currentTier.price,
        idempotencyKey,
        merchantSlug,
        device,
        customerAuth.user.id,
        lastSeen.current.get(JSON.stringify([requestScope, selectedTier, normalizedImei]))
      );

      if (activeScope.current !== requestScope) return;
      if (outcome.pending) {
        pendingLookup.start({
          lookupId: outcome.pending.lookupId,
          pollAfterMs: outcome.pending.pollAfterMs,
          tier: selectedTier,
          device,
          recovery,
        });
      } else if (outcome.error !== null) {
        if (outcome.previousReportAvailable && outcome.lookupId) lastSeen.current.set(JSON.stringify([requestScope, selectedTier, normalizedImei]), outcome.lookupId);
        setError(outcome.error);
      } else {
        setResultScope(requestScope);
        setResult(outcome.result);
        setResultLookupId(outcome.lookupId);
        if (outcome.lookupId) lastSeen.current.set(JSON.stringify([requestScope, selectedTier, normalizedImei]), outcome.lookupId);
        // `currentTier` here is the value closed over at submit time, not the
        // hook's live value at response time — exactly the snapshot needed.
        setResultTier(currentTier);
      }
      setNeedsSignIn(outcome.needsSignIn);
      setNeedsWalletFunding(outcome.needsWalletFunding);
      if (!outcome.keepRequestIdentity) {
        await clearImeiRecoveryKey(recovery.storageKey, recovery.idempotencyKey).catch(() => undefined);
      }
    } catch {
      if (activeScope.current !== requestScope) return;
      // An uncertain outcome keeps its identity for an explicit safe retry.
      setError('Network error. Please check your connection and try again.');
      setNeedsWalletFunding(false);
      setNeedsSignIn(false);
    } finally {
      // The POST latch must release even when optional recovery work fails.
      submitting.current = false;
      setIsLoading(false);
    }
  };

  return {
    error,
    isLoading,
    needsSignIn,
    needsWalletFunding,
    pendingLookup,
    result: resultScope === requestScope ? result : null,
    resultDevice,
    resultLookupId,
    resultTier,
    runCheck,
    openReport(report: ImeiReport) {
      if (submitting.current || pendingLookup.pending) return;
      setResultScope(requestScope);
      setResult(report.result);
      setResultLookupId(report.lookupId);
      lastSeen.current.set(JSON.stringify([requestScope, report.tier, report.result.imei.trim().toUpperCase()]), report.lookupId);
      setResultTier(IMEI_SERVICE_TIERS[report.tier]);
      setResultDevice(report.device);
      setError(null);
      setNeedsSignIn(false);
      setNeedsWalletFunding(false);
    },
    reset() {
      pendingLookup.clear();
      setResult(null);
      setResultLookupId(null);
      setResultTier(null);
      setError(null);
      setNeedsSignIn(false);
      setNeedsWalletFunding(false);
    },
  };
}
