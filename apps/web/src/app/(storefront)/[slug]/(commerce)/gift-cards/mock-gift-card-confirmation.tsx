'use client';

import { useState } from 'react';
import {
  confirmGiftCardPurchase,
  type GiftCardCheckoutQuote,
  type GiftCardPurchaseStatus,
} from '@/lib/gift-cards/checkout';
import { resolveGiftCardFulfillment } from '@/lib/gift-cards/fulfillment';
import { createMockGiftCardWallet } from '@/lib/gift-cards/mock-wallet';

const formatBalance = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
});

export function MockGiftCardConfirmation({
  quote,
}: {
  quote: GiftCardCheckoutQuote;
}) {
  const [wallet] = useState(() => createMockGiftCardWallet(2_000_000));
  const [result, setResult] = useState<GiftCardPurchaseStatus>();
  const [pending, setPending] = useState(false);
  const [voucher, setVoucher] = useState<string>();

  async function confirm() {
    setPending(true);
    try {
      setResult(
        await confirmGiftCardPurchase(quote, wallet, async ({ reference }) => ({
          orderId: `mock-${reference}`,
        }))
      );
    } finally {
      setPending(false);
    }
  }

  function checkMockDelivery() {
    if (result?.status !== 'submitted') return;
    const delivery = resolveGiftCardFulfillment(
      { orderId: result.orderId, reference: quote.id },
      {
        orderUuid: result.orderId,
        referenceId: quote.id,
        status: 'success',
        replay: 'SYNTHETIC-REPLAY',
      },
      (replay) => (replay === 'SYNTHETIC-REPLAY' ? 'DEMO-GIFT-CARD' : null)
    );
    if (delivery.status === 'fulfilled') setVoucher(delivery.voucher);
  }

  return (
    <div className="mt-3 space-y-3">
      <p>
        Simulated wallet balance: {formatBalance.format(wallet.balance() / 100)}
      </p>
      {!result && (
        <button
          className="min-h-11 rounded-md border px-4 py-2 font-medium"
          disabled={pending}
          onClick={confirm}
          type="button"
        >
          {pending ? 'Confirming…' : 'Confirm with test wallet'}
        </button>
      )}
      <p role="status">
        {result?.status === 'submitted' &&
          'Test debit recorded and mock Petrock order accepted.'}
        {result?.status === 'expired' &&
          'Price expired. Get a fresh price to continue.'}
        {result?.status === 'insufficient' &&
          'The test wallet has insufficient balance.'}
        {(result?.status === 'unknown' || result?.status === 'submitting') &&
          'The test order is awaiting reconciliation.'}
      </p>
      {result?.status === 'submitted' && !voucher && (
        <button
          className="min-h-11 rounded-md border px-4 py-2 font-medium"
          onClick={checkMockDelivery}
          type="button"
        >
          Check test delivery
        </button>
      )}
      {voucher && (
        <p role="status">
          Simulated voucher: <code>{voucher}</code>
        </p>
      )}
    </div>
  );
}
