'use client';

import { useState } from 'react';
import { DvaModal } from '@/components/storefront/ogabassey/pages/checkout/components/DvaModal';
import type { DvaData } from '@/components/storefront/ogabassey/pages/checkout/types';

const data: DvaData = {
  account_number: '1234567890',
  account_name: 'Fixture Buyer',
  bank_name: 'Fixture Bank',
  bank_code: 'FIX',
  amount: 750,
  reference: 'fixture-dva-reference',
  orderId: 'fixture-order',
};

export function DvaModalFixture() {
  const [isOpen, setIsOpen] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [dismissal, setDismissal] = useState<string | null>(null);

  const close = () => {
    setIsOpen(false);
    setDismissal('DVA modal closed.');
  };

  return (
    <main className="min-h-screen bg-gray-50 p-8 text-gray-900">
      <section
        aria-label="DVA modal browser fixture"
        className="mx-auto max-w-xl rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
      >
        <h1 className="text-xl font-bold">DVA modal fixture</h1>
        <p className="mt-2 text-sm text-gray-600">
          Synthetic local data only. This page does not contact a payment
          provider.
        </p>
        <button
          className="mt-5 rounded-lg bg-store-primary px-4 py-2 font-semibold text-white"
          onClick={() => {
            setIsVerifying(false);
            setCopiedText(null);
            setDismissal(null);
            setIsOpen(true);
          }}
          type="button"
        >
          Open DVA modal
        </button>
        {dismissal && (
          <p className="mt-4 text-sm" role="status">
            {dismissal}
          </p>
        )}
      </section>
      {isOpen && (
        <DvaModal
          copiedText={copiedText}
          data={data}
          formatCurrency={(amount) => `₦${amount.toLocaleString()}`}
          isVerifying={isVerifying}
          onClose={close}
          onConfirmTransfer={() => setIsVerifying(true)}
          onCopyToClipboard={(text) => setCopiedText(text)}
        />
      )}
    </main>
  );
}
