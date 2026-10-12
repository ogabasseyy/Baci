'use client';

import { Check, Clock, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import {
  isUtilityBackfillTab,
  useUtilityVoucherBackfill,
} from './use-utility-voucher-backfill';

interface UtilitySuccessViewProps {
  activeTab: string;
  amount: number;
  merchantSlug?: string | null;
  onClose: () => void;
  onSettled?: () => void;
  processing?: boolean;
  reference: string;
  voucherPin?: string | null;
}

export function UtilitySuccessView({
  activeTab,
  amount,
  merchantSlug,
  onClose,
  onSettled,
  processing = false,
  reference,
  voucherPin,
}: UtilitySuccessViewProps) {
  // A 202 processing view polls history for the late voucher / terminal
  // outcome: without this the customer has no web path to a token the
  // reconciler persists after this screen renders (a replay would be
  // suppressed by the stale guard, and push/email can fail).
  const backfill = useUtilityVoucherBackfill({
    enabled: processing && !voucherPin,
    merchantSlug,
    reference,
    utilityTab: activeTab,
  });
  const resolvedPin = voucherPin ?? backfill.pin;
  const succeeded = !processing || backfill.successful || resolvedPin !== null;
  // Failed is terminal only once the refund is confirmed: the failed
  // status persists BEFORE the refund RPC runs, so an unconfirmed
  // failure keeps polling and never claims the refund landed.
  const failedTerminal =
    processing && backfill.failed && backfill.refundConfirmed;
  const failedPending =
    processing && backfill.failed && !backfill.refundConfirmed;
  const resolvedProcessing = processing && !succeeded && !failedTerminal;
  // Polling copy only when the loop can actually run (known tab +
  // merchant slug); otherwise the static check-back copy applies.
  const polling =
    resolvedProcessing &&
    !failedPending &&
    !!merchantSlug &&
    isUtilityBackfillTab(activeTab);

  // Tell the purchase owner the shown 202 settled, exactly once, so it
  // forgets the retained key (buy-again mints fresh instead of
  // replaying this vend as a new success) and refetches the wallet.
  // Immediate outcomes already finalized inline — only backfilled
  // terminality fires this.
  const settledFiredRef = useRef(false);
  useEffect(() => {
    if (!onSettled || settledFiredRef.current) {
      return;
    }
    const backfilledTerminal =
      backfill.pin !== null ||
      backfill.successful ||
      (backfill.failed && backfill.refundConfirmed);
    if (backfilledTerminal) {
      settledFiredRef.current = true;
      onSettled();
    }
  }, [backfill, onSettled]);

  if (failedTerminal || failedPending) {
    const refundCopy =
      failedTerminal && backfill.refundedAmount !== null
        ? `₦${backfill.refundedAmount.toLocaleString()} was refunded to your wallet.`
        : failedTerminal
          ? 'Any debited amount was refunded to your wallet.'
          : 'Your refund is being processed — check your wallet shortly.';
    return (
      <div className="text-center py-8">
        <div className="size-16 bg-[var(--store-danger-bg,#fee2e2)] text-[var(--store-danger-text,#dc2626)] rounded-full flex items-center justify-center mx-auto mb-4">
          <X size={32} />
        </div>
        <h4 className="text-xl font-bold text-gray-900 mb-2">
          Purchase failed
        </h4>
        <p className="text-gray-500 mb-6">
          The purchase failed. {refundCopy}
        </p>
        <div className="bg-gray-50 rounded-lg p-4 mb-6 text-sm">
          <div className="flex justify-between mb-2">
            <span className="text-gray-500">Service</span>
            <span className="font-medium capitalize">{activeTab}</span>
          </div>
          <div className="flex justify-between mb-2">
            <span className="text-gray-500">Amount</span>
            <span className="font-medium">₦{amount.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Ref</span>
            <span className="font-mono text-xs">{reference}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-full bg-store-primary text-store-primary-text font-bold py-3 rounded-xl hover:bg-store-primary/90 transition-colors"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="text-center py-8">
      {resolvedProcessing ? (
        <div className="size-16 bg-store-primary/10 text-store-primary rounded-full flex items-center justify-center mx-auto mb-4">
          <Clock size={32} />
        </div>
      ) : (
        <div className="size-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <Check size={32} />
        </div>
      )}
      <h4 className="text-xl font-bold text-gray-900 mb-2">
        {resolvedProcessing ? 'Processing…' : 'Success!'}
      </h4>
      <p className="text-gray-500 mb-6">
        {resolvedProcessing
          ? polling
            ? 'Your transaction is being processed. This screen updates automatically when it settles.'
            : 'Your transaction is being processed. It can still fail or be refunded — check back shortly.'
          : 'Your transaction has been processed successfully.'}
      </p>
      <div className="bg-gray-50 rounded-lg p-4 mb-6 text-sm">
        <div className="flex justify-between mb-2">
          <span className="text-gray-500">Service</span>
          <span className="font-medium capitalize">{activeTab}</span>
        </div>
        <div className="flex justify-between mb-2">
          <span className="text-gray-500">Amount</span>
          <span className="font-medium">₦{amount.toLocaleString()}</span>
        </div>
        <div className="flex justify-between mb-2">
          <span className="text-gray-500">Ref</span>
          <span className="font-mono text-xs">{reference}</span>
        </div>
        {resolvedPin ? (
          <div className="flex justify-between">
            <span className="text-store-background-text/70">
              Voucher / Token
            </span>
            <span className="font-mono text-xs">{resolvedPin}</span>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="w-full bg-store-primary text-store-primary-text font-bold py-3 rounded-xl hover:bg-store-primary/90 transition-colors"
      >
        Done
      </button>
    </div>
  );
}
