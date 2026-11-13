import { useEffect, useRef, useState } from 'react';
import { usePiggyvestCapabilityNow } from '@/hooks/use-piggyvest-capability-now';
import {
  fetchExistingSavingsPlanFunding,
  fetchSavingsPlanFunding,
} from '@/lib/customer-savings';
import { PLAN_NOT_SET_UP_MESSAGE } from '@/lib/customer-savings-plan-funding';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { usePiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability';
import { getErrorMessage } from './start-savings-controller.utils';

export type SavingsPlanFundingPhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'pending'
  | 'not_started'
  // Pending, but the stored setup claim expired: setup may run again. Only
  // reported to a status-only caller that asked for setup status.
  | 'setup_retryable'
  | 'unavailable'
  | 'error';

type UseSavingsPlanFundingInput = {
  activeMerchantId?: string;
  activeMerchantSlug?: string;
  goalId: string | null;
  identityKey?: string;
  loadExisting?: boolean;
  // A never-started goal (404 SAVINGS_WALLET_NOT_FOUND) reads as 'pending'
  // (still being set up), not as an error, for status-only callers.
  notFoundMeansPending?: boolean;
  // A never-started goal reads as 'not_started', so a status-only caller
  // can offer setup. Takes precedence over notFoundMeansPending.
  notFoundMeansNotStarted?: boolean;
};

function isWalletNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'SAVINGS_WALLET_NOT_FOUND'
  );
}

// The status endpoint answers a never-started setup with a 404 code, which
// the API client throws before the response is read as not_found.
function planFundingErrorMessage(error: unknown): string {
  if (isWalletNotFound(error)) {
    return PLAN_NOT_SET_UP_MESSAGE;
  }
  return getErrorMessage(error, 'Unable to load the plan account.');
}

function isBvn(value: string): boolean {
  return /^\d{11}$/.test(value.trim());
}

export function useSavingsPlanFunding({
  activeMerchantId,
  activeMerchantSlug,
  goalId,
  identityKey,
  loadExisting = false,
  notFoundMeansPending = false,
  notFoundMeansNotStarted = false,
}: UseSavingsPlanFundingInput) {
  const [phase, setPhase] = useState<SavingsPlanFundingPhase>('idle');
  const [statusCode, setStatusCode] = useState<string | null>(null);
  const [fundingError, setFundingError] = useState<string | null>(null);
  const primaryCapability = usePiggyvestPrimaryCapability(activeMerchantId);
  // Hide the BVN field only after the server explicitly confirms primary:
  // while the capability probe is still pending (null), collect BVN for the
  // legacy path. Primary provisioning ignores client BVN (it resolves
  // identity from auth plus goal ownership), so an early primary
  // confirmation never misuses the collected value.
  // The live verdict too (Codex): a wallet-read rollback written elsewhere
  // shows the BVN field again without a remount, so the legacy fallback
  // never submits an empty BVN.
  const verdictNow = usePiggyvestCapabilityNow(activeMerchantId);
  const planFundingRequiresBvn =
    !isPiggyvestPrimaryMerchant(activeMerchantId) ||
    primaryCapability !== true ||
    verdictNow === false;
  const scopeKey = JSON.stringify([
    goalId,
    identityKey,
    activeMerchantId,
    activeMerchantSlug,
  ]);
  const scopeKeyRef = useRef(scopeKey);
  const requestGenerationRef = useRef(0);

  if (scopeKeyRef.current !== scopeKey) {
    scopeKeyRef.current = scopeKey;
    requestGenerationRef.current += 1;
    setPhase('idle');
    setStatusCode(null);
    setFundingError(null);
  }

  const isCurrentRequest = (generation: number, requestScopeKey: string) =>
    requestGenerationRef.current === generation &&
    scopeKeyRef.current === requestScopeKey;

  const applyResponse = (
    response: Awaited<ReturnType<typeof fetchSavingsPlanFunding>>
  ) => {
    setStatusCode(response.code ?? null);
    // Goal bank account numbers are deliberately never retained: only the
    // readiness status is kept, so no UI can reveal one.
    if (response.status === 'ready') {
      setPhase('ready');
    } else if (response.status === 'pending') {
      setPhase(
        notFoundMeansNotStarted && response.setupRetryable === true
          ? 'setup_retryable'
          : 'pending'
      );
    } else {
      setPhase('unavailable');
    }
  };

  // A silent read (used while polling a pending setup) keeps the current
  // phase on screen instead of flashing 'loading'.
  const fetchExistingPlanFunding = async (options?: { silent?: boolean }) => {
    if (!goalId) return;
    const requestScopeKey = scopeKey;
    const generation = ++requestGenerationRef.current;
    if (!options?.silent) setPhase('loading');
    setFundingError(null);
    try {
      const response = await fetchExistingSavingsPlanFunding({
        goalId,
        merchantId: activeMerchantId,
        merchantSlug: activeMerchantSlug,
      });
      if (!isCurrentRequest(generation, requestScopeKey)) return;
      applyResponse(response);
    } catch (error) {
      if (!isCurrentRequest(generation, requestScopeKey)) return;
      if (
        (notFoundMeansNotStarted || notFoundMeansPending) &&
        isWalletNotFound(error)
      ) {
        setStatusCode(null);
        setPhase(notFoundMeansNotStarted ? 'not_started' : 'pending');
        return;
      }
      // A silent read belongs to the bounded setup poll: a transient failure
      // leaves the phase pending and is reported to the poll, which retries
      // and only calls failExistingPlanFunding once its attempts run out.
      if (options?.silent) throw error;
      setFundingError(planFundingErrorMessage(error));
      setPhase('error');
    }
  };
  const failExistingPlanFunding = (error: unknown) => {
    setFundingError(planFundingErrorMessage(error));
    setPhase('error');
  };
  const fetchExistingPlanFundingRef = useRef(fetchExistingPlanFunding);
  fetchExistingPlanFundingRef.current = fetchExistingPlanFunding;

  const fetchPlanFunding = async (
    bvn: string,
    options?: { enableInterestAccrual?: boolean }
  ) => {
    const trimmedBvn = bvn.trim();
    if (!goalId) {
      setFundingError('Create the plan before fetching its account.');
      setPhase('error');
      return;
    }
    if (planFundingRequiresBvn && !isBvn(trimmedBvn)) {
      setFundingError('Enter the 11-digit BVN linked to this plan.');
      setPhase('error');
      return;
    }
    const requestScopeKey = scopeKey;
    const generation = ++requestGenerationRef.current;
    setPhase('loading');
    setFundingError(null);
    try {
      const response = await fetchSavingsPlanFunding({
        bvn: trimmedBvn,
        goalId,
        enableInterestAccrual: options?.enableInterestAccrual,
        merchantId: activeMerchantId,
        merchantSlug: activeMerchantSlug,
      });
      if (!isCurrentRequest(generation, requestScopeKey)) return;
      applyResponse(response);
    } catch (error) {
      if (!isCurrentRequest(generation, requestScopeKey)) return;
      setFundingError(planFundingErrorMessage(error));
      setPhase('error');
    }
  };

  useEffect(
    () => () => {
      requestGenerationRef.current += 1;
    },
    []
  );

  const automaticLookupKey =
    loadExisting && goalId && identityKey ? scopeKey : null;

  useEffect(() => {
    if (automaticLookupKey) {
      void fetchExistingPlanFundingRef.current();
    }
  }, [automaticLookupKey]);

  return {
    failExistingPlanFunding,
    fetchExistingPlanFunding,
    fetchPlanFunding,
    fundingError,
    planFundingPhase: phase,
    planFundingStatusCode: statusCode,
    planFundingRequiresBvn,
  };
}
