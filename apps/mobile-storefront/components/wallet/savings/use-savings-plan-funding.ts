import { useEffect, useRef, useState } from 'react';
import {
  fetchExistingSavingsPlanFunding,
  fetchSavingsPlanFunding,
} from '@/lib/customer-savings';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import type { SavingsPlanFundingAccount } from '@/schemas/customer-savings';
import { getErrorMessage } from './start-savings-controller.utils';

export type SavingsPlanFundingPhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'pending'
  | 'unavailable'
  | 'error';

type UseSavingsPlanFundingInput = {
  activeMerchantId?: string;
  activeMerchantSlug?: string;
  goalId: string | null;
  identityKey?: string;
  loadExisting?: boolean;
};

function isBvn(value: string): boolean {
  return /^\d{11}$/.test(value.trim());
}

export function useSavingsPlanFunding({
  activeMerchantId,
  activeMerchantSlug,
  goalId,
  identityKey,
  loadExisting = false,
}: UseSavingsPlanFundingInput) {
  const [phase, setPhase] = useState<SavingsPlanFundingPhase>('idle');
  const [accounts, setAccounts] = useState<SavingsPlanFundingAccount[]>([]);
  const [statusCode, setStatusCode] = useState<string | null>(null);
  const [fundingError, setFundingError] = useState<string | null>(null);
  const planFundingRequiresBvn = !isPiggyvestPrimaryMerchant(activeMerchantId);
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
    setAccounts([]);
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
    if (response.status === 'ready') {
      setAccounts(response.accounts ?? []);
      setPhase('ready');
    } else if (response.status === 'pending') {
      setPhase('pending');
    } else {
      setPhase('unavailable');
    }
  };

  const fetchExistingPlanFunding = async () => {
    if (!goalId) return;
    const requestScopeKey = scopeKey;
    const generation = ++requestGenerationRef.current;
    setPhase('loading');
    setAccounts([]);
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
      setFundingError(
        getErrorMessage(error, 'Unable to load the plan account.')
      );
      setPhase('error');
    }
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
    setAccounts([]);
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
      setFundingError(
        getErrorMessage(error, 'Unable to load the plan account.')
      );
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
    fetchExistingPlanFunding,
    fetchPlanFunding,
    fundingError,
    planFundingAccounts: accounts,
    planFundingPhase: phase,
    planFundingStatusCode: statusCode,
    planFundingRequiresBvn,
  };
}
