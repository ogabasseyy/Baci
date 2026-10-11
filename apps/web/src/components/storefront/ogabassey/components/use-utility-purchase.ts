'use client';

import { type Dispatch, type SetStateAction, useRef, useState } from 'react';
import type {
  Customer,
  CustomerUser,
} from '@/contexts/customer-auth-context';
import { toast } from '@/hooks/use-toast';
import type { UtilityCheckoutPayload } from './utility-checkout';
import { submitUtilityCheckout } from './utility-checkout-submit';
import { useUtilityIdempotencyKey } from './use-utility-idempotency-key';
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
    forgetAttemptKey,
    getWalletIdempotencyKey,
    isAttemptReplay,
    isAttemptStale,
    noteAttemptReference,
    wasAttemptKeyRecalled,
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
    const customerName =
      [customer?.first_name, customer?.last_name]
        .filter(Boolean)
        .join(' ')
        .trim() || customer?.email || user?.email || 'Customer';
    const result = await submitUtilityCheckout({
      payload,
      merchantSlug: merchantSlug || 'ogabassey',
      customerName,
      customerPhone: customer?.phone,
      getWalletIdempotencyKey,
    });

    if (latestIdentityRef.current !== submittingIdentity) {
      // Shared browser switched (or signed out) while the request was
      // in flight: the wallet + screen now belong to someone else, so
      // drop this result instead of debiting their display or showing
      // them the previous customer's reference.
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
      // Capture replay-ness BEFORE forgetting: forget drops the attempt
      // signature the check reads.
      const replayResolvesProcessing =
        !result.processing && isAttemptReplay(result.reference);
      // A recalled key means an identical submit already went out, so a
      // non-processing success is ambiguous even with no noted reference
      // (lost response + reload: the refetch already reflects the debit).
      // Refresh for server truth instead of decrementing. When the first
      // POST never reached the server, this submit performed the debit —
      // refresh observes that too, just asynchronously.
      const recalledKeySuccess =
        !result.processing && wasAttemptKeyRecalled();
      if (!result.processing) {
        if (isAttemptStale(result.reference)) {
          // The remembered purchase completed long ago: this replay
          // answers a NEW intent with the old vend. Forget so the next
          // tap mints fresh, and say so instead of presenting it.
          forgetAttemptKey();
          toast({
            title: 'Purchase Already Completed',
            description: `This purchase already completed (${result.reference}). Submit again to make a new purchase.`,
            variant: 'destructive',
          });
          setLoading(false);
          return;
        }
        forgetAttemptKey();
      } else {
        noteAttemptReference(result.reference);
        refreshWallet();
      }
      clearIntent();
      // A replayed reference is the same debit — only apply the balance
      // effect the first time it is seen. Buy-again purchases mint new
      // references, so genuine repeat buys still decrement. Non-terminal
      // `processing` defers the effect entirely (without recording the
      // reference): the vend may still fail and refund, and a stale-low
      // balance would wrongly block the next submit as underfunded.
      // A success that resolves a NOTED processing response is a replay
      // whose debit the earlier refresh already picked up (remounts
      // refetch too) — refresh for server truth instead of decrementing
      // a second time.
      if (replayResolvesProcessing || recalledKeySuccess) {
        appliedBalanceRefs.current.add(result.reference);
        refreshWallet();
      } else if (
        !result.processing &&
        !appliedBalanceRefs.current.has(result.reference)
      ) {
        appliedBalanceRefs.current.add(result.reference);
        // Prefer the server's post-transaction balance when cashback was
        // credited — the local decrement would otherwise display too low a
        // balance and block a valid follow-up purchase as underfunded.
        if (typeof result.cashback?.newBalance === 'number') {
          setWalletBalance(result.cashback.newBalance);
        } else {
          setWalletBalance((balance) => Math.max(balance - payload.amount, 0));
        }
      }
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
      // Terminal 4xx (validation, failed fulfillment, key collision) already
      // persisted its outcome server-side: rotate so a corrected retry is a
      // fresh attempt instead of replaying the dead transaction. Network and
      // 5xx failures stay ambiguous — keep the key so the retry dedupes.
      // Mirrors mobile's shouldRotateWalletIdempotencyKeyForError.
      if (
        typeof result.status === 'number' &&
        result.status >= 400 &&
        result.status < 500
      ) {
        forgetAttemptKey();
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
