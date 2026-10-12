'use client';

import { type Dispatch, type SetStateAction, useRef, useState } from 'react';
import type {
  Customer,
  CustomerUser,
} from '@/contexts/customer-auth-context';
import { toast } from '@/hooks/use-toast';
import type { UtilityCheckoutPayload } from './utility-checkout';
import { submitUtilityCheckout } from './utility-checkout-submit';
import { applyUtilityPurchaseBalanceEffect } from './utility-purchase-balance';
import {
  finalizeSwitchedAttempt,
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

type UtilityPurchaseStep = 'details' | 'processing' | 'success';

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
 * Purchase orchestration extracted from `UtilityModal` (300-line budget).
 * Owns the submit lifecycle (loading/step/reference/amount/voucher,
 * idempotency); blocks underfunded submits (funding-panel callback) and
 * loading/error wallet states separately, and retains the key while
 * processing so resubmits replay instead of double-charging.
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
  // Per-render identity; user-first (customer-first flips on hydration
  // → false switch → double-debit). A stale result is discarded.
  const latestIdentityRef = useRef<string | null>(null);
  latestIdentityRef.current = user?.id ?? customer?.id ?? null;
  const {
    captureAttemptKey,
    forgetScopedKey,
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
      })
    ) {
      return;
    }

    setLoading(true);
    const submittingIdentity = user?.id ?? customer?.id ?? null;
    // Raw auth user id for route-side binding (no customer fallback).
    const submittingUserId = user?.id ?? null;
    const customerName =
      [customer?.first_name, customer?.last_name]
        .filter(Boolean)
        .join(' ')
        .trim() || customer?.email || user?.email || 'Customer';
    // Per-execution capture: concurrent submits can't redirect completion.
    const captured: { attempt: UtilityIdempotencyAttempt | null } = {
      attempt: null,
    };
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

    if (latestIdentityRef.current !== submittingIdentity) {
      // Switched mid-flight: finalize the SUBMITTER's entry, drop the result.
      finalizeSwitchedAttempt(captured.attempt, result);
      toast({
        title: 'Account changed',
        description:
          'The signed-in account changed while the purchase was processing. The result was discarded.',
      });
      setLoading(false);
      return;
    }

    if (result.kind === 'wallet-success') {
      // Terminal forgets (fresh buy-again); processing keeps (a fresh
      // resubmit would bypass the dedupe row and debit twice). Refresh
      // instead of decrementing: a stale HIGH balance would pass the
      // underfunded pre-check for a purchase the server rejects.
      const scoped = captured.attempt?.scoped;
      const replayResolvesProcessing =
        !result.processing &&
        scoped !== undefined &&
        isScopedReplay(scoped, result.reference);
      if (!result.processing) {
        if (scoped !== undefined && isScopedStale(scoped, result.reference)) {
          // Stale replay answers a NEW intent with the old vend: forget
          // so the next tap mints fresh, and say so.
          forgetScopedKey(scoped);
          toast({
            title: 'Purchase Already Completed',
            description: `This purchase already completed (${result.reference}). Submit again to make a new purchase.`,
            variant: 'destructive',
          });
          setLoading(false);
          return;
        }
        if (scoped !== undefined) {
          forgetScopedKey(scoped);
        }
      } else {
        if (scoped !== undefined) {
          noteScopedReference(scoped, result.reference);
        }
        refreshWallet();
      }
      clearIntent();
      applyUtilityPurchaseBalanceEffect({
        appliedReferences: appliedBalanceRefs.current,
        // Recalled key ⇒ identical submit already went out: ambiguous.
        isAmbiguousReplay:
          replayResolvesProcessing ||
          (!result.processing && captured.attempt?.recalled === true),
        refreshWallet,
        result,
        setWalletBalance,
        submitAmount: payload.amount,
      });
      setTransactionRef(result.reference);
      markAttemptShown(scoped ?? null);
      setSuccessAmount(result.amount);
      setTransactionVoucherPin(result.voucherPin ?? null);
      // A 202 can still fail or be refunded: never the success screen.
      setStep(result.processing ? 'processing' : 'success');
      toast({
        title: result.processing
          ? 'Purchase Processing'
          : 'Purchase Successful',
        description: result.processing
          ? `Your ${activeTab} purchase is processing.`
          : `Your ${activeTab} purchase was successful!`,
      });
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

  // Backfill proved the shown 202 terminal: forget its key (fresh
  // buy-again) and refetch the wallet (debit/refund settled late).
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
