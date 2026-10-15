'use client';

import { type Dispatch, type SetStateAction, useRef, useState } from 'react';
import type { Customer, CustomerUser } from '@/contexts/customer-auth-context';
import { getLiveCustomerIdentity } from '@/contexts/customer-live-identity';
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
import {
  type AirtimeDataSubmit,
  type BillSubmit,
  buildAirtimeDataPayload,
  buildBillPayload,
} from './utility-purchase-payloads';
import { buildUtilityCheckoutWalletPayload } from './utility-checkout-wallet-payload';
import { buildVtuWalletPayloadSignature } from './utility-vtu-payload-signature';
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
  /** Live balance reader (R78 6sN80p): gate-time read, not pre-await snapshot. */
  getWalletBalance: () => number;
  /** Live error reader (R81 P2): gate-time read, not pre-await snapshot. */
  getWalletError: () => boolean;
  refreshWallet: () => void;
  setWalletBalance: Dispatch<SetStateAction<number>>;
  user: CustomerUser | null;
  walletLoading: boolean;
}

export type UtilityPurchaseStep = 'details' | 'processing' | 'success';

interface UseUtilityPurchaseReturn {
  handleAirtimeDataSubmit: (data: AirtimeDataSubmit) => void;
  handleBillSubmit: (data: BillSubmit) => void;
  loading: boolean;
  setStep: Dispatch<SetStateAction<UtilityPurchaseStep>>;
  settleBackfilledAttempt: () => void;
  step: UtilityPurchaseStep;
  /** True from submit click until the purchase settles (covers the pre-loading settle await). */
  submitting: boolean;
  successAmount: number;
  transactionRef: string;
  transactionVoucherPin: string | null;
}

/** Purchase lifecycle + idempotency (unfunded/loading/error block). */
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
  getWalletBalance,
  getWalletError,
  refreshWallet,
  setWalletBalance,
  user,
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
  // No render-derived identity ref: settlement compares against the
  // LIVE auth identity (see below) — a ref updated only during
  // render still names the submitting account when the switch lands
  // after dispatch but before React commits the rerender.
  const submittingRef = useRef(false);
  const {
    captureAttemptKey,
    forgetScopedKey,
    isAttemptRetained,
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

  const handlePurchaseInner = async (payload: UtilityCheckoutPayload) => {
    // Settle gate (R60) awaited BEFORE the peek (R66 6rvh_M): a stale
    // peek would bypass, then mint fresh underfunded. Branch-on-null
    // keeps idle submits synchronously dispatched.
    const settlementPass = getPendingVtuSettlementPass();
    if (settlementPass) {
      await settlementPass;
      if (!isResultViewActive()) return; // R73: closed during the gate.
    }
    // Peek signs the same payload the submit signs (shared builder).
    const submittingUserId = user?.id ?? null; // Raw auth id: route-side binding.
    const names = [customer?.first_name, customer?.last_name].filter(Boolean);
    const customerName =
      names.join(' ').trim() || customer?.email || user?.email || 'Customer';
    const isRetainedReplay = isAttemptRetained(
      buildVtuWalletPayloadSignature(
        buildUtilityCheckoutWalletPayload({
          merchantSlug: merchantSlug || 'ogabassey',
          customerName,
          customerPhone: customer?.phone,
          expectedUserId: submittingUserId,
          payload,
        })
      )
    );
    if (
      !checkUtilityPurchaseReadiness({
        amount: payload.amount,
        canFundByBankTransfer,
        isAuthLoading,
        isAuthenticated,
        isRetainedReplay,
        merchantId,
        onInsufficientWalletBalance,
        refreshWallet,
        user,
        getWalletBalance,
        getWalletError,
        walletLoading,
        walletRefreshPending: isWalletRefreshPending(),
      })
    ) {
      return;
    }

    setLoading(true);
    const submittingIdentity = user?.id ?? customer?.id ?? null;
    // Pre-submit balance generation (Codex R98 P2): the success
    // effect decrements locally only while state still holds this
    // value — a refresh that lands post-debit refreshes for server
    // truth instead of double-counting the debit.
    const submitBalance = getWalletBalance();
    // Per-execution capture: concurrent submits can't redirect completion.
    const captured: { attempt: UtilityIdempotencyAttempt | null } = {
      attempt: null,
    };
    // Pass already awaited above the peek: capture recalls post-settle.
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
      // Modal closed mid-flight: preserve, don't forget (reopen replays).
      finalizeSuppressedAttempt(captured.attempt, result);
      return;
    }

    // LIVE identity (Codex R95 P1, web mirror of the R94 mobile
    // fix): the auth context publishes synchronously at every
    // mutation, so a logout/switch that lands after dispatch but
    // before the next render still discards the stale result here.
    // User-first like the capture: customer-first flips on hydration.
    const liveIdentity = getLiveCustomerIdentity();
    const liveSubmittingIdentity =
      liveIdentity.userId ?? liveIdentity.customerId ?? null;
    if (liveSubmittingIdentity !== submittingIdentity) {
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
        submitBalance,
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

  // Render-visible twin of submittingRef (Codex R81 P2): the
  // settle await precedes loading state, so tabs (and any other
  // UI lock) must key off state set here — a ref alone never
  // re-renders the tab bar during the wait.
  const [submitting, setSubmitting] = useState(false);
  // In-flight guard (R67 6rwGM2): the settle await precedes loading
  // state, so a sync-flipping ref must block repeat clicks.
  const handlePurchase = (payload: UtilityCheckoutPayload) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    void handlePurchaseInner(payload).finally(() => {
      submittingRef.current = false;
      setSubmitting(false);
    });
  };

  // Backfill proved the shown 202 terminal: forget its key + refetch.
  const settleBackfilledAttempt = () => {
    settleShownAttempt();
    refreshWallet();
  };

  const handleAirtimeDataSubmit = (data: AirtimeDataSubmit) => {
    handlePurchase(buildAirtimeDataPayload(data, activeTab));
  };

  const handleBillSubmit = (data: BillSubmit) => {
    handlePurchase(buildBillPayload(data));
  };

  return {
    handleAirtimeDataSubmit,
    handleBillSubmit,
    loading,
    setStep,
    settleBackfilledAttempt,
    step,
    submitting,
    successAmount,
    transactionRef,
    transactionVoucherPin,
  };
}
