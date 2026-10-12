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
  // Debits already reflected in the displayed balance: a retained key
  // replays the SAME transaction, so replays must not decrement again.
  const appliedBalanceRefs = useRef<Set<string>>(new Set());
  // Latest identity per render; a mid-flight switch discards the stale
  // result instead of writing one customer's update into another's
  // session. User-first: customer-first flips on hydration (false
  // switch → discard + double-debit the retry).
  const latestIdentityRef = useRef<string | null>(null);
  latestIdentityRef.current = user?.id ?? customer?.id ?? null;
  const {
    captureAttemptKey,
    forgetScopedKey,
    isScopedReplay,
    isScopedStale,
    noteScopedReference,
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
    // Per-execution capture (a container, not a shared ref): concurrent
    // submits can never redirect this attempt's completion.
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
      // Shared browser switched mid-flight: finalize the SUBMITTER's
      // entry, then drop the result instead of debiting the new display.
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
      // Terminal success forgets the key for a fresh buy-again slot.
      // 'processing' keeps it: Done unmounts the modal, and a resubmit with
      // a fresh key would bypass the dedupe row and debit twice. The
      // deferred debit still needs reconciling even if this transaction
      // is never replayed, so refresh instead of decrementing: a stale
      // HIGH balance would let the underfunded pre-check pass a purchase
      // the server will reject.
      const scoped = captured.attempt?.scoped;
      const replayResolvesProcessing =
        !result.processing &&
        scoped !== undefined &&
        isScopedReplay(scoped, result.reference);
      if (!result.processing) {
        if (scoped !== undefined && isScopedStale(scoped, result.reference)) {
          // The remembered purchase completed long ago: this replay
          // answers a NEW intent with the old vend. Forget so the next
          // tap mints fresh, and say so instead of presenting it.
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
      setSuccessAmount(result.amount);
      setTransactionVoucherPin(result.voucherPin ?? null);
      // A 202 processing vend can still fail or be refunded — show the
      // pending screen, never the success screen.
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
      // Definitive 4xx: outcome recorded, rotate so retry is fresh.
      // Pre-route/5xx/unknown: keep the key so the retry dedupes.
      if (captured.attempt && shouldRotateVtuKeyForStatus(result.status)) {
        forgetScopedKey(captured.attempt.scoped);
      }
      // A failed vend may have restored the debit: refetch for the next check.
      refreshWallet();
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
    transactionVoucherPin,
  };
}
