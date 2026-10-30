'use client';

import {
  IMEI_SERVICE_TIERS,
  type ImeiDeviceCategory,
  type ImeiServiceTierDefinition,
  type ImeiServiceTierKey,
  isValidDeviceIdentifier,
} from '@baci/shared/imei';
import { useEffect, useRef, useState } from 'react';
import { useOptionalCustomerAuth } from '@/contexts/customer-auth-context';
import { createImeiIdempotencyKey } from './imei-checker-idempotency-key';
import { performImeiCheck } from './imei-checker-request';
import type { ImeiRequestIdentity, ImeiResult } from './imei-checker-types';
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
  const requestIdentityRef = useRef<
    (ImeiRequestIdentity & { scope: string }) | null
  >(null);
  const requestScope = `${merchantSlug ?? ''}:${customerAuth?.customer?.id ?? 'anonymous'}`;
  const submitting = useRef(false);
  const [resultDevice, setResultDevice] = useState<ImeiDeviceCategory | null>(
    null
  );
  const pendingLookup = useImeiPendingLookup({
    customerId: customerAuth?.customer?.id,
    merchantSlug,
  });

  useEffect(() => {
    const terminal = pendingLookup.terminal;
    if (!terminal) return;

    requestIdentityRef.current = null;
    submitting.current = false;
    setIsLoading(false);
    if (terminal.kind === 'complete') {
      setError(null);
      setResult(terminal.result);
      setResultLookupId(terminal.lookupId);
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
  }, [pendingLookup]);

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
    const requestIdentity = requestIdentityRef.current;
    if (!merchantSlug) {
      setNeedsSignIn(false);
      setError('This storefront is unavailable. Refresh and try again.');
      setNeedsWalletFunding(false);
      return;
    }

    setNeedsSignIn(false);
    submitting.current = true;
    setIsLoading(true);
    setResultDevice(device);
    if (!preserveResult) setResult(null);
    setError(null);
    setNeedsWalletFunding(false);

    const normalizedImei = imei.trim();
    const existingIdentityMatches =
      requestIdentity?.scope === requestScope &&
      requestIdentity?.imei === normalizedImei &&
      requestIdentity.tier === selectedTier;

    let idempotencyKey: string;
    try {
      idempotencyKey = existingIdentityMatches
        ? requestIdentity.key
        : createImeiIdempotencyKey();
    } catch (err) {
      console.error('IMEI check failed:', err);
      setError('Network error. Please check your connection and try again.');
      setNeedsWalletFunding(false);
      submitting.current = false;
      setIsLoading(false);
      return;
    }

    if (idempotencyKey !== requestIdentity?.key) {
      requestIdentityRef.current = {
        imei: normalizedImei,
        tier: selectedTier,
        key: idempotencyKey,
        scope: requestScope,
      };
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
      requestIdentityRef.current = null;
    }

    if (outcome.pending) {
      pendingLookup.start({
        lookupId: outcome.pending.lookupId,
        pollAfterMs: outcome.pending.pollAfterMs,
        tier: selectedTier,
        device,
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
    setNeedsSignIn(outcome.needsSignIn);
    setNeedsWalletFunding(outcome.needsWalletFunding);
    // This latch covers only the POST. Pending state owns the polling lock,
    // including clearing it when the authenticated customer changes.
    submitting.current = false;
    setIsLoading(false);
  };

  return {
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
