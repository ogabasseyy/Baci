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
}

/**
 * Purchase orchestration extracted from `UtilityModal` to keep that component
 * under the 300-line modularity budget. Owns the checkout submit lifecycle
 * (loading/success step, transaction reference, wallet-only idempotency) so the
 * modal only wires props and renders. Wallet-only: blocks the submit when the
 * balance cannot cover the bill and notifies the caller so it can open the
 * funding panel. Loading/error wallet states block separately (never reported
 * as insufficient funds), and the idempotency key is retained while a purchase
 * is processing so a resubmit replays instead of double-charging.
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
  // References whose debit is already reflected in the displayed balance. A
  // retained key replays the SAME transaction on resubmit, so without this
  // guard every processing replay would decrement the balance again.
  const appliedBalanceRefs = useRef<Set<string>>(new Set());
  // Latest signed-in identity, refreshed every render. Compared against
  // the submitter when a checkout resolves so an account switch (or
  // sign-out) mid-flight discards the stale result instead of writing
  // one customer's balance update + reference into another's session.
  const latestIdentityRef = useRef<string | null>(null);
  latestIdentityRef.current = customer?.id ?? user?.id ?? null;
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
    const submittingIdentity = customer?.id ?? user?.id ?? null;
    // Raw auth user id for route-side binding (NOT the customer
    // fallback): the route rejects when the ambient session differs.
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
      // Definitive route 4xx already persisted its outcome server-side:
      // rotate so a corrected retry is a fresh attempt instead of
      // replaying the dead transaction. Pre-route 401/403/413/415/429,
      // 5xx, and non-responses stay ambiguous — keep the key.
      if (captured.attempt && shouldRotateVtuKeyForStatus(result.status)) {
        forgetScopedKey(captured.attempt.scoped);
      }
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
