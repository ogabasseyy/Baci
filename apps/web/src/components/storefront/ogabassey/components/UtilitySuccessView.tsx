'use client';

import { Check, Clock, X } from 'lucide-react';
import {
  isUtilityVoucherBackfillTab,
  useUtilityVoucherBackfill,
} from './use-utility-voucher-backfill';

interface UtilitySuccessViewProps {
  activeTab: string;
  amount: number;
  merchantSlug?: string | null;
  onClose: () => void;
  processing?: boolean;
  reference: string;
  voucherPin?: string | null;
}

export function UtilitySuccessView({
  activeTab,
  amount,
  merchantSlug,
  onClose,
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
  const failed = processing && backfill.failed;
  const resolvedProcessing = processing && !resolvedPin && !failed;
  const polling =
    processing &&
    !voucherPin &&
    !resolvedPin &&
    !failed &&
    isUtilityVoucherBackfillTab(activeTab);

  if (failed) {
    return (
      <div className="text-center py-8">
        <div className="size-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <X size={32} />
        </div>
        <h4 className="text-xl font-bold text-gray-900 mb-2">
          Purchase failed
        </h4>
        <p className="text-gray-500 mb-6">
          The purchase failed. If your wallet was debited, the amount was
          refunded.
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
            ? 'Your transaction is being processed. Your token will appear here automatically.'
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
