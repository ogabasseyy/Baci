'use client';

import { type Dispatch, type SetStateAction, useRef, useState } from 'react';
import type {
  Customer,
  CustomerUser,
} from '@/contexts/customer-auth-context';
import { toast } from '@/hooks/use-toast';
import type { UtilityCheckoutPayload } from './utility-checkout';
import { createWalletIdempotencyKey } from './utility-checkout';
import { submitUtilityCheckout } from './utility-checkout-submit';
import type { UtilityTabId } from './UtilityTabs';

interface UseUtilityPurchaseParams {
  activeTab: UtilityTabId;
  clearIntent: () => void;
  customer: Customer | null;
  isAuthLoading: boolean;
  isAuthenticated: boolean;
  merchantSlug: string | undefined;
  onInsufficientWalletBalance?: () => void;
  setWalletBalance: Dispatch<SetStateAction<number>>;
  user: CustomerUser | null;
  walletBalance: number;
}

interface AirtimeDataSubmit {
  phoneNumber: string;
  amount: number;
  networkProvider: string;
  dataPlanCode?: string;
}

interface BillSubmit {
  amount: number;
  billItemIdentifier: string;
  billerCode?: string;
  customerAddress?: string;
  customerIdentifier: string;
  billerName: string;
  productCode?: string;
  provider?: 'kuda' | 'monnify';
  requireValidationRef?: boolean;
  type: string;
  validationReference?: string;
}

interface UseUtilityPurchaseReturn {
  handleAirtimeDataSubmit: (data: AirtimeDataSubmit) => void;
  handleBillSubmit: (data: BillSubmit) => void;
  loading: boolean;
  setStep: Dispatch<SetStateAction<'details' | 'success'>>;
  step: 'details' | 'success';
  successAmount: number;
  transactionRef: string;
}

/**
 * Purchase orchestration extracted from `UtilityModal` to keep that component
 * under the 300-line modularity budget. Owns the checkout submit lifecycle
 * (loading/success step, transaction reference, wallet-only idempotency) so the
 * modal only wires props and renders. Wallet-only: blocks the submit when the
 * balance cannot cover the bill and notifies the caller so it can open the
 * funding panel.
 */
export function useUtilityPurchase({
  activeTab,
  clearIntent,
  customer,
  isAuthLoading,
  isAuthenticated,
  merchantSlug,
  onInsufficientWalletBalance,
  setWalletBalance,
  user,
  walletBalance,
}: UseUtilityPurchaseParams): UseUtilityPurchaseReturn {
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'details' | 'success'>('details');
  const [transactionRef, setTransactionRef] = useState('');
  const [successAmount, setSuccessAmount] = useState(0);
  const walletIdempotencyAttemptRef = useRef<{
    key: string;
    payloadSignature: string;
  } | null>(null);

  const getWalletIdempotencyKey = (payloadSignature: string) => {
    if (
      walletIdempotencyAttemptRef.current?.payloadSignature !== payloadSignature
    ) {
      walletIdempotencyAttemptRef.current = {
        key: createWalletIdempotencyKey(),
        payloadSignature,
      };
    }
    return walletIdempotencyAttemptRef.current.key;
  };

  const handlePurchase = async (payload: UtilityCheckoutPayload) => {
    if (isAuthLoading) {
      toast({
        title: 'Checking account',
        description: 'Please wait while we confirm your session.',
      });
      return;
    }

    if (!isAuthenticated || !user) {
      toast({
        title: 'Sign in required',
        description: 'Please sign in to use utility checkout.',
        variant: 'destructive',
      });
      return;
    }

    // Wallet-only checkout: the wallet must cover the full bill — there is
    // no card fallback. Stop here (before any network call) and let the
    // caller open the funding panel so the customer can top up.
    if (walletBalance < payload.amount) {
      toast({
        title: 'Insufficient wallet balance',
        description: `Fund your wallet with at least ₦${payload.amount.toLocaleString()} to complete this purchase.`,
        variant: 'destructive',
      });
      onInsufficientWalletBalance?.();
      return;
    }

    setLoading(true);
    const customerName =
      [customer?.first_name, customer?.last_name]
        .filter(Boolean)
        .join(' ')
        .trim() || customer?.email || user.email || 'Customer';
    const result = await submitUtilityCheckout({
      payload,
      merchantSlug: merchantSlug || 'ogabassey',
      customerName,
      customerPhone: customer?.phone,
      getWalletIdempotencyKey,
    });

    if (result.kind === 'wallet-success') {
      walletIdempotencyAttemptRef.current = null;
      clearIntent();
      setWalletBalance((balance) => Math.max(balance - payload.amount, 0));
      setTransactionRef(result.reference);
      setSuccessAmount(result.amount);
      setStep('success');
      toast({
        title: result.processing
          ? 'Purchase Processing'
          : 'Purchase Successful',
        description: result.processing
          ? `Your ${activeTab} purchase is processing.`
          : `Your ${activeTab} purchase was successful!`,
      });
    } else if (result.kind === 'error') {
      toast({
        title: 'Transaction Failed',
        description: result.message,
        variant: 'destructive',
      });
    }
    setLoading(false);
  };

  const handleAirtimeDataSubmit = (data: AirtimeDataSubmit) => {
    handlePurchase({
      type: activeTab,
      phoneNumber: data.phoneNumber,
      amount: data.amount,
      networkProvider: data.networkProvider,
      dataPlanCode: data.dataPlanCode,
    });
  };

  const handleBillSubmit = (data: BillSubmit) => {
    handlePurchase({
      type: data.type,
      amount: data.amount,
      billItemIdentifier: data.billItemIdentifier,
      billerCode: data.billerCode,
      ...(data.customerAddress
        ? { customerAddress: data.customerAddress }
        : {}),
      customerIdentifier: data.customerIdentifier,
      billerName: data.billerName,
      productCode: data.productCode,
      provider: data.provider,
      requireValidationRef: data.requireValidationRef,
      validationReference: data.validationReference,
    });
  };

  return {
    handleAirtimeDataSubmit,
    handleBillSubmit,
    loading,
    setStep,
    step,
    successAmount,
    transactionRef,
  };
}
