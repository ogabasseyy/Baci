'use client';

import { Check, Clock } from 'lucide-react';

interface UtilitySuccessViewProps {
  activeTab: string;
  amount: number;
  onClose: () => void;
  processing?: boolean;
  reference: string;
  voucherPin?: string | null;
}

export function UtilitySuccessView({
  activeTab,
  amount,
  onClose,
  processing = false,
  reference,
  voucherPin,
}: UtilitySuccessViewProps) {
  return (
    <div className="text-center py-8">
      {processing ? (
        <div className="size-16 bg-store-primary/10 text-store-primary rounded-full flex items-center justify-center mx-auto mb-4">
          <Clock size={32} />
        </div>
      ) : (
        <div className="size-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <Check size={32} />
        </div>
      )}
      <h4 className="text-xl font-bold text-gray-900 mb-2">
        {processing ? 'Processing…' : 'Success!'}
      </h4>
      <p className="text-gray-500 mb-6">
        {processing
          ? 'Your transaction is being processed. It can still fail or be refunded — check back shortly.'
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
        {voucherPin ? (
          <div className="flex justify-between">
            <span className="text-gray-500">Voucher / Token</span>
            <span className="font-mono text-xs">{voucherPin}</span>
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
