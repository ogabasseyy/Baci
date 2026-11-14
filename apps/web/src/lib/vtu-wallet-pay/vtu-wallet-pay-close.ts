import 'server-only';
import { NextResponse } from 'next/server';
import type { WalletPayRuntime } from '@/lib/piggyvest/wallet-pay-runtime';
import type { walletPayScope } from '@/lib/piggyvest/wallet-pay-scope';

type Close = (input: {
  runtime: WalletPayRuntime;
  scope: ReturnType<typeof walletPayScope>;
  transactionId: string;
  cancelOperationId?: string;
}) => Promise<boolean>;
type PurchaseRef = Omit<Parameters<Close>[0], 'cancelOperationId'>;

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
export async function cancelVtuWalletPay(
  close: Close,
  ref: PurchaseRef,
  operationId: string
) {
  // Only the operation this sheet issued: a stale cancel never releases a
  // newer attempt of the same purchase (Codex P2).
  const closed = await close({ ...ref, cancelOperationId: operationId });
  return NextResponse.json(
    {
      status: closed ? 'cancelled' : 'not_cancelled',
      transactionId: ref.transactionId,
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}

/**
 * A start refused before any payment was issued (wallet pay off, another
 * merchant, the wallet not ready) closes the purchase it just prepared, so it
 * never holds the purchase intent with nothing that could pay or vend it
 * (Codex P2). A re-check or payment keeps its purchase.
 */
export async function refuseBeforeIssue(
  closeUnissued: (
    transactionId: string,
    merchantId: string
  ) => Promise<boolean>,
  start: { transactionId: string; merchantId: string; isStart: boolean },
  response: Response
) {
  if (start.isStart)
    await Promise.resolve()
      .then(() => closeUnissued(start.transactionId, start.merchantId))
      .catch(() => false);
  return response;
}
