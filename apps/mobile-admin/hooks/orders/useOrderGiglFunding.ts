import { type Dispatch, type SetStateAction, useRef, useState } from 'react';
import {
  getOrRequestMerchantWalletFundingAccount,
  type MerchantWalletFundingAccount,
} from '@/lib/order-gigl-shipping';
import type { OrderGiglShippingState } from '@/lib/order-gigl-shipping-state';

interface UseOrderGiglFundingParams {
  enabled: boolean;
  orderId: string;
  setError: Dispatch<SetStateAction<string | null>>;
  setState: Dispatch<SetStateAction<OrderGiglShippingState>>;
}

export function useOrderGiglFunding({
  enabled,
  orderId,
  setError,
  setState,
}: UseOrderGiglFundingParams) {
  const [fundingAccount, setFundingAccount] =
    useState<MerchantWalletFundingAccount | null>(null);
  const fundingRef = useRef(false);
  const fundingOperationRef = useRef(0);
  const enabledRef = useRef(enabled);
  const orderIdRef = useRef(orderId);
  enabledRef.current = enabled;
  orderIdRef.current = orderId;

  const startFunding = async () => {
    if (!enabledRef.current || fundingRef.current) return;
    const fundingOrderId = orderIdRef.current;
    const fundingOperation = ++fundingOperationRef.current;
    const isCurrent = () =>
      fundingOperationRef.current === fundingOperation &&
      orderIdRef.current === fundingOrderId &&
      enabledRef.current;
    fundingRef.current = true;
    setState('funding');
    setError(null);
    try {
      const response = await getOrRequestMerchantWalletFundingAccount();
      if (!isCurrent()) return;
      setFundingAccount(response.account);
      setState(
        response.account?.status === 'active' ? 'ready' : 'funding_pending'
      );
    } catch (fundingError: unknown) {
      if (!isCurrent()) return;
      setError(
        fundingError instanceof Error
          ? fundingError.message
          : 'Unable to prepare wallet funding.'
      );
      setState('error');
    } finally {
      if (isCurrent()) fundingRef.current = false;
    }
  };

  const refreshFundingAccount = async () => {
    if (!enabledRef.current || fundingRef.current) return null;
    const fundingOrderId = orderIdRef.current;
    const fundingOperation = ++fundingOperationRef.current;
    const isCurrent = () =>
      fundingOperationRef.current === fundingOperation &&
      orderIdRef.current === fundingOrderId &&
      enabledRef.current;
    fundingRef.current = true;
    setState('funding');
    setError(null);
    try {
      const response = await getOrRequestMerchantWalletFundingAccount();
      if (!isCurrent()) return null;
      setFundingAccount(response.account);
      setState(
        response.account?.status === 'active' ? 'ready' : 'funding_pending'
      );
      return response.account;
    } catch (fundingError: unknown) {
      if (!isCurrent()) return null;
      setError(
        fundingError instanceof Error
          ? fundingError.message
          : 'Unable to refresh wallet funding status.'
      );
      setState('error');
      return null;
    } finally {
      if (isCurrent()) fundingRef.current = false;
    }
  };

  const reset = () => {
    fundingOperationRef.current += 1;
    fundingRef.current = false;
    setFundingAccount(null);
  };

  return { fundingAccount, refreshFundingAccount, reset, startFunding };
}
