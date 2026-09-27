'use client';

import { useState } from 'react';
import { CryptoPaymentModal } from '@/components/storefront/ogabassey/pages/checkout/components/CryptoPaymentModal';
import type {
  CryptoPaymentData,
  CryptoVerificationStatus,
} from '@/components/storefront/ogabassey/pages/checkout/types';

const verificationStates: CryptoVerificationStatus[] = [
  'idle',
  'checking',
  'pending',
  'confirmed',
  'failed',
];

const fixtureQr = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" shape-rendering="crispEdges"><rect width="21" height="21" fill="white"/><path fill="black" d="M0 0h7v7H0zm2 2v3h3V2zM14 0h7v7h-7zm2 2v3h3V2zM0 14h7v7H0zm2 2v3h3v-3zM9 0h2v2H9zm0 4h2v3H9zm-2 5h3v2H7zm5 0h2v2h-2zm4 0h2v2h-2zm-8 4h2v2H8zm4 0h3v2h-3zm5 0h2v2h-2zm-8 4h2v2H9zm4 0h2v2h-2zm4 0h2v2h-2z"/></svg>'
)}`;

const paymentData: CryptoPaymentData = {
  address: 'T7WHdR7vj4i3L4575w8V5hV8tKf9w2Q3xY',
  chain: 'TRX',
  currency: 'USDT',
  amount: 1250,
  confirmation_time: '10 minutes',
  orderId: 'fixture-order-001',
  reference: 'fixture-crypto-reference',
  sessionId: 'fixture-crypto-session',
  paymentId: 'fixture-crypto-payment',
  qrcode: fixtureQr,
};

const closeConfirmation =
  "Are you sure you want to close? If you've already sent payment, your order will still be processed once the payment is detected.";

export function CryptoPaymentModalFixture() {
  const [verificationStatus, setVerificationStatus] =
    useState<CryptoVerificationStatus>('idle');
  const [isOpen, setIsOpen] = useState(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [dismissal, setDismissal] = useState<string | null>(null);
  const isVerifying =
    verificationStatus === 'checking' || verificationStatus === 'pending';

  const copyToClipboard = (text: string) => {
    if (!navigator.clipboard?.writeText) return;
    void navigator.clipboard.writeText(text).then(
      () => setCopiedText(text),
      () => setCopiedText(null)
    );
  };

  return (
    <main className="min-h-screen bg-gray-50 p-8 text-gray-900">
      <section
        aria-label="Crypto payment modal browser fixture"
        className="mx-auto max-w-xl rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
      >
        <h1 className="text-xl font-bold">Crypto payment modal fixture</h1>
        <p className="mt-2 text-sm text-gray-600">
          Synthetic local data only. This page does not contact a payment
          provider.
        </p>
        <fieldset className="mt-6">
          <legend className="text-sm font-semibold">
            Set verification state
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {verificationStates.map((state) => (
              <label
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-2 text-sm"
                key={state}
              >
                <input
                  checked={verificationStatus === state}
                  name="crypto-verification-state"
                  onChange={() => setVerificationStatus(state)}
                  type="radio"
                  value={state}
                />
                {state}
              </label>
            ))}
          </div>
        </fieldset>
        <button
          className="mt-5 rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white"
          onClick={() => {
            setDismissal(null);
            setCopiedText(null);
            setIsOpen(true);
          }}
          type="button"
        >
          Open crypto payment modal
        </button>
        {dismissal && (
          <p className="mt-4 text-sm" role="status">
            {dismissal}
          </p>
        )}
      </section>

      {isOpen && (
        <CryptoPaymentModal
          copiedText={copiedText}
          data={paymentData}
          isVerifying={isVerifying}
          onClose={() => {
            setIsOpen(false);
            setDismissal('Modal closed from header.');
          }}
          onCloseConfirm={() => {
            if (window.confirm(closeConfirmation)) {
              setIsOpen(false);
              setDismissal('Modal closed from order status.');
            }
          }}
          onCopyToClipboard={copyToClipboard}
          onVerify={() => setVerificationStatus('checking')}
          verificationStatus={verificationStatus}
        />
      )}
    </main>
  );
}
