import 'server-only';
import { NextResponse } from 'next/server';
import type { WalletPayRuntime } from '@/lib/piggyvest/wallet-pay-runtime';
import type { walletPayScope } from '@/lib/piggyvest/wallet-pay-scope';

type Close = (input: {
  runtime: WalletPayRuntime;
  scope: ReturnType<typeof walletPayScope>;
  transactionId: string;
  cancelIssued?: boolean;
}) => Promise<boolean>;
type PurchaseRef = Omit<Parameters<Close>[0], 'cancelIssued'>;

/**
 * Payment answers that end it unpaid: the purchase is closed so a later store
 * credit purchase of the same thing never joins a row nothing can vend.
 */
export const ENDED_UNPAID = new Set(['insufficient', 'released', 'expired']);

/** A re-check answers from the stored state alone (it never sends). */
export function recheckStatus(state: string) {
  if (state === 'confirmed' || state === 'needs_review' || state === 'released')
    return state;
  return 'pending';
}

/** Closes the unpaid purchase; a failure leaves it for a later close. */
export async function closeUnpaidQuietly(close: Close, ref: PurchaseRef) {
  return await Promise.resolve()
    .then(() => close(ref))
    .catch(() => false);
}

/**
 * The pay sheet closed before any PIN: release the issued payment (never a
 * reserved one, which the database refuses) and close the purchase.
 */
export async function cancelVtuWalletPay(close: Close, ref: PurchaseRef) {
  const closed = await close({ ...ref, cancelIssued: true });
  return NextResponse.json(
    {
      status: closed ? 'cancelled' : 'not_cancelled',
      transactionId: ref.transactionId,
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}
