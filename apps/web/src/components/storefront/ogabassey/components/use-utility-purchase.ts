'use client';

import { type Dispatch, type SetStateAction, useRef, useState } from 'react';
import type { Customer, CustomerUser } from '@/contexts/customer-auth-context';
import { toast } from '@/hooks/use-toast';
import type { UtilityCheckoutPayload } from './utility-checkout';
import { submitUtilityCheckout } from './utility-checkout-submit';
import { getPendingVtuSettlementPass } from './use-utility-retained-settlement';
import { applyUtilityWalletSuccessOutcome } from './utility-purchase-wallet-success';
import {
  finalizeSuppressedAttempt,
  shouldRotateVtuKeyForStatus,
  useUtilityIdempotencyKey,
  type UtilityIdempotencyAttempt,
} from './use-utility-idempotency-key';
import { checkUtilityPurchaseReadiness } from './utility-purchase-readiness';
import type { UtilityTabId } from './UtilityTabs';

interface UseUtilityPurchaseParams {
  activeTab: UtilityTabId;
  canFundByBankTransfer: boolean;
  clearIntent: () => void;
  customer: Customer | null;
  isAuthLoading: boolean;
  isAuthenticated: boolean;
  merchantId: string | undefined;
  merchantSlug: string | undefined;
  onInsufficientWalletBalance?: () => void;
  isWalletRefreshPending: () => boolean;
  refreshWallet: () => void;
  setWalletBalance: Dispatch<SetStateAction<number>>;
  user: CustomerUser | null;
  walletBalance: number;
  walletError: boolean;
  walletLoading: boolean;
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

export type UtilityPurchaseStep = 'details' | 'processing' | 'success';

interface UseUtilityPurchaseReturn {
  handleAirtimeDataSubmit: (data: AirtimeDataSubmit) => void;
  handleBillSubmit: (data: BillSubmit) => void;
  loading: boolean;
  setStep: Dispatch<SetStateAction<UtilityPurchaseStep>>;
  settleBackfilledAttempt: () => void;
  step: UtilityPurchaseStep;
  successAmount: number;
  transactionRef: string;
  transactionVoucherPin: string | null;
}

/**
 * Purchase orchestration: submit lifecycle + idempotency. Blocks
 * underfunded/loading/error submits; retains the key while processing
 * so resubmits replay instead of double-charging.
 */
export function useUtilityPurchase({
  activeTab,
  canFundByBankTransfer,
  clearIntent,
  customer,
  isAuthLoading,
  isAuthenticated,
  merchantId,
  merchantSlug,
  onInsufficientWalletBalance,
  isWalletRefreshPending,
  refreshWallet,
  setWalletBalance,
  user,
  walletBalance,
  walletError,
  walletLoading,
}: UseUtilityPurchaseParams): UseUtilityPurchaseReturn {
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<UtilityPurchaseStep>('details');
  const [transactionRef, setTransactionRef] = useState('');
  const [successAmount, setSuccessAmount] = useState(0);
  const [transactionVoucherPin, setTransactionVoucherPin] = useState<
    string | null
  >(null);
  // Replays reuse the SAME transaction: never decrement twice.
  const appliedBalanceRefs = useRef<Set<string>>(new Set());
  // Per-render identity; user-first (customer-first flips on hydration).
  const latestIdentityRef = useRef<string | null>(null);
  latestIdentityRef.current = user?.id ?? customer?.id ?? null;
  const {
    captureAttemptKey,
    forgetScopedKey,
    isResultViewActive,
    isScopedReplay,
    isScopedStale,
    markAttemptShown,
    noteScopedReference,
    settleShownAttempt,
  } = useUtilityIdempotencyKey({
    customerId: customer?.id,
    merchantId,
    userId: user?.id,
  });

  const handlePurchase = async (payload: UtilityCheckoutPayload) => {
    if (
      !checkUtilityPurchaseReadiness({
        amount: payload.amount,
        canFundByBankTransfer,
        isAuthLoading,
        isAuthenticated,
        merchantId,
        onInsufficientWalletBalance,
        refreshWallet,
        user,
        walletBalance,
        walletError,
        walletLoading,
        walletRefreshPending: isWalletRefreshPending(),
      })
    ) {
      return;
    }

    setLoading(true);
    const submittingIdentity = user?.id ?? customer?.id ?? null;
    const submittingUserId = user?.id ?? null; // Raw auth id: route-side binding.
    const names = [customer?.first_name, customer?.last_name].filter(Boolean);
    const customerName =
      names.join(' ').trim() || customer?.email || user?.email || 'Customer';
    // Per-execution capture: concurrent submits can't redirect completion.
    const captured: { attempt: UtilityIdempotencyAttempt | null } = {
      attempt: null,
    };
    // Settle-then-submit gate (Codex R60 6rs7PV): a submit racing the
    // modal-open settlement pass must not recall a key the pass is
    // about to forget. Branch-on-null keeps the idle submit
    // synchronously dispatched.
    const settlementPass = getPendingVtuSettlementPass();
    if (settlementPass) {
      await settlementPass;
    }
    const result = await submitUtilityCheckout({
      payload,
      merchantSlug: merchantSlug || 'ogabassey',
      customerName,
      customerPhone: customer?.phone,
      expectedUserId: submittingUserId,
      getWalletIdempotencyKey: (payloadSignature: string) => {
        captured.attempt = captureAttemptKey(payloadSignature);
        return captured.attempt.key;
      },
    });

    if (!isResultViewActive()) {
      // Modal closed mid-flight: preserve like a suppressed switch —
      // forgetting here would mint fresh on reopen and debit twice.
      finalizeSuppressedAttempt(captured.attempt, result);
      return;
    }

    if (latestIdentityRef.current !== submittingIdentity) {
      // Switched mid-flight: finalize the SUBMITTER's entry, drop the result.
      finalizeSuppressedAttempt(captured.attempt, result);
      toast({
        title: 'Account changed',
        description:
          'The signed-in account changed while the purchase was processing. The result was discarded.',
      });
      setLoading(false);
      return;
    }

    if (result.kind === 'wallet-success') {
      const stale = applyUtilityWalletSuccessOutcome({
        activeTab,
        appliedReferences: appliedBalanceRefs.current,
        attempt: captured.attempt,
        forgetScopedKey,
        isScopedReplay,
        isScopedStale,
        markAttemptShown,
        noteScopedReference,
        clearIntent,
        refreshWallet,
        result,
        setLoading,
        setStep,
        setSuccessAmount,
        setTransactionRef,
        setTransactionVoucherPin,
        setWalletBalance,
        submitAmount: payload.amount,
      });
      if (stale) {
        return;
      }
    } else if (result.kind === 'error') {
      // 4xx rotates (fresh retry); pre-route/5xx/unknown keeps (dedupes).
      if (captured.attempt && shouldRotateVtuKeyForStatus(result.status)) {
        forgetScopedKey(captured.attempt.scoped);
      }
      refreshWallet();
      toast({
        title: 'Transaction Failed',
        description: result.message,
        variant: 'destructive',
      });
    }
    setLoading(false);
  };

  // Backfill proved the shown 202 terminal: forget its key + refetch.
  const settleBackfilledAttempt = () => {
    settleShownAttempt();
    refreshWallet();
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
    settleBackfilledAttempt,
    step,
    successAmount,
    transactionRef,
    transactionVoucherPin,
  };
}
