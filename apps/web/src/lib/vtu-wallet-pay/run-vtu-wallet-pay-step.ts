import 'server-only';
import { NextResponse } from 'next/server';
import {
  type WalletPayAnswer,
  walletPayAccepted,
  walletPayRefuse,
  walletPayResponse,
} from '@/lib/piggyvest/wallet-pay-http';
import type { WalletPayRuntime } from '@/lib/piggyvest/wallet-pay-runtime';
import { walletPayScope } from '@/lib/piggyvest/wallet-pay-scope';
import type { FulfilledVtuResult } from '@/lib/vtu-fulfillment';
import { mapFulfillmentToResponse } from '@/lib/vtu-fulfillment-response';
import {
  type DeliverVtuWalletPaymentDeps,
  deliverVtuWalletPayment,
  VtuWalletPaymentMismatchError,
} from './deliver-vtu-wallet-payment';
import {
  cancelVtuWalletPay,
  closeUnpaidQuietly,
  ENDED_UNPAID,
  recheckStatus,
} from './vtu-wallet-pay-close';

type Identity = { merchantId: string; customerId: string; userId: string };
type Scope = ReturnType<typeof walletPayScope>;
type Issued =
  | {
      status: 'issued';
      operationId: string;
      amountKobo: number;
      expiresAt?: string;
    }
  | {
      status: 'pending' | 'confirmed' | 'needs_review';
      operationId: string;
      amountKobo: number;
    }
  | { status: 'unavailable' | 'conflict' };

export interface VtuWalletPayStepDeps {
  /** The caller's own purchase: PiggyVest-paid or not, and its amount. */
  readPurchase: (transactionId: string) => Promise<{
    piggyvestPaid: boolean;
    amount: number;
    /** The row's status; only a pending row may get a new payment. */
    status?: string;
    merchantId?: string;
    customerId?: string;
  } | null>;
  readRuntime: () => WalletPayRuntime | null;
  readRecoveryRuntime: () => WalletPayRuntime;
  resolveIdentity: (runtime: WalletPayRuntime) => Promise<Identity | null>;
  findForPurchase: (input: {
    runtime: WalletPayRuntime;
    scope: Scope;
    purpose: 'vtu';
    purchaseRef: string;
  }) => Promise<{ operationId: string; state: string } | null>;
  issue: (input: {
    runtime: WalletPayRuntime;
    scope: Scope;
    request: { purpose: 'vtu'; purchaseRef: string; amountKobo: number };
  }) => Promise<Issued>;
  check: (input: {
    runtime: WalletPayRuntime;
    scope: Scope;
    operationId: string;
  }) => Promise<{
    state: string;
    purpose: string;
    purchaseRef: string;
    amountKobo: number;
  } | null>;
  pay: (input: {
    runtime: WalletPayRuntime;
    scope: Scope;
    operationId: string;
    pinProof: string;
  }) => Promise<WalletPayAnswer>;
  delivery: (
    runtime: WalletPayRuntime
  ) => Omit<DeliverVtuWalletPaymentDeps, 'fulfil'>;
  /** Closes the purchase once its payment ended unpaid (best effort). */
  closeUnpaid: (input: {
    runtime: WalletPayRuntime;
    scope: Scope;
    transactionId: string;
    cancelIssued?: boolean;
  }) => Promise<boolean>;
}

const unavailable = () =>
  walletPayRefuse(
    'Paying from your PiggyVest wallet is not available right now.',
    'PIGGYVEST_PAY_UNAVAILABLE',
    503
  );

function resultResponse(result: FulfilledVtuResult) {
  // The refund of a failed purchase goes to the PiggyVest wallet.
  if (result.status === 'failed')
    return NextResponse.json(
      {
        error: result.error,
        reference: result.reference,
        refund: 'piggyvest_wallet',
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  return mapFulfillmentToResponse(result);
}

/**
 * Airtime, data or a bill paid from the PiggyVest main wallet (dark). Runs
 * inside the wallet-only checkout for a row prepared as PiggyVest-paid:
 *  - no operation id: issue (or report) the payment for this purchase;
 *    nothing is charged;
 *  - operation id + PIN proof: spend the proof and send the payment once,
 *    then vend under the delivery claim once it is confirmed;
 *  - operation id + empty proof: a status re-check that never sends money.
 * The payment carries the stored purchase amount (fixed when the row was
 * prepared), never one from the request.
 */
export async function runVtuWalletPayStep(
  input: {
    transactionId: string;
    merchantId: string;
    customerId: string;
    operationId?: string;
    pinProof?: string;
    /** The sheet closed before any PIN: release the issued payment. */
    cancel?: boolean;
    fulfil: (walletPayClaimed: boolean) => Promise<FulfilledVtuResult>;
  },
  deps: VtuWalletPayStepDeps
): Promise<Response> {
  const { transactionId, operationId } = input;
  // Only a purchase prepared as PiggyVest-paid is ever paid from it: a store
  // credit purchase (a replay or joined in-flight one) never is.
  const purchase = await deps.readPurchase(transactionId);
  // The purchase must also be this checkout's own (merchant and customer).
  if (
    !purchase?.piggyvestPaid ||
    (purchase.merchantId !== undefined &&
      purchase.merchantId !== input.merchantId) ||
    (purchase.customerId !== undefined &&
      purchase.customerId !== input.customerId)
  )
    return walletPayRefuse(
      'This purchase is not paid from your PiggyVest wallet.',
      'PAYMENT_METHOD_MISMATCH',
      409
    );
  const recheck = operationId !== undefined && (input.pinProof ?? '') === '';
  let live: WalletPayRuntime | null;
  try {
    live = deps.readRuntime();
  } catch {
    live = null;
  }
  // Starting or paying needs wallet pay switched on; a re-check of money
  // already sent runs on the recovery runtime so nothing is stranded.
  if (!live && !recheck) return unavailable();
  const runtime = live ?? deps.readRecoveryRuntime();
  if (runtime.merchantId !== input.merchantId)
    return walletPayRefuse(
      'Paying from your PiggyVest wallet is not available yet.',
      'PIGGYVEST_PAY_UNAVAILABLE',
      409
    );
  const identity = await deps.resolveIdentity(runtime);
  if (!identity || identity.customerId !== input.customerId)
    return walletPayRefuse(
      'Finish setting up your PiggyVest wallet to pay from it.',
      'PIGGYVEST_WALLET_NOT_READY',
      409
    );
  const scope = walletPayScope(runtime, identity);
  // Closed before any PIN: release the issued payment (never a reserved
  // one) and close the purchase, so a later store credit attempt starts a
  // fresh row instead of joining this one (Codex P2).
  const purchaseRef = { runtime, scope, transactionId };
  if (input.cancel === true && operationId !== undefined)
    return await cancelVtuWalletPay(deps.closeUnpaid, purchaseRef);
  // The amount fixed when the purchase was prepared, never the request's.
  const amountKobo = Math.round(purchase.amount * 100);
  const extra = { transactionId, amountKobo };

  if (operationId === undefined) {
    // A payment that already moved (or holds) money is reported, never
    // followed by a second one for the same purchase.
    const existing = await deps.findForPurchase({
      runtime,
      scope,
      purpose: 'vtu',
      purchaseRef: transactionId,
    });
    if (existing && existing.state !== 'issued')
      return walletPayAccepted(
        existing.state === 'needs_review'
          ? 'payment_review'
          : 'payment_pending',
        existing.operationId,
        extra
      );
    // A purchase closed unpaid (or otherwise finished) never gets a payment.
    if (purchase.status !== undefined && purchase.status !== 'pending')
      return walletPayRefuse(
        'This payment did not go through. Please start again.',
        'PAYMENT_NOT_COMPLETED',
        409
      );
    const issued = await deps.issue({
      runtime,
      scope,
      request: { purpose: 'vtu', purchaseRef: transactionId, amountKobo },
    });
    if (!('operationId' in issued)) {
      if (issued.status === 'unavailable') {
        // Nothing was issued (e.g. no collection wallet): close the row so
        // a store credit retry never joins it (Codex P2).
        await closeUnpaidQuietly(deps.closeUnpaid, purchaseRef);
        return unavailable();
      }
      return walletPayRefuse(
        'Please refresh and try again.',
        'PAYMENT_CONFLICT',
        409
      );
    }
    if (issued.status === 'issued')
      return walletPayAccepted('payment_required', issued.operationId, {
        ...extra,
        expiresAt: issued.expiresAt,
      });
    return walletPayAccepted(
      issued.status === 'needs_review' ? 'payment_review' : 'payment_pending',
      issued.operationId,
      extra
    );
  }

  const invalid = () =>
    walletPayRefuse(
      'This payment is not for this purchase.',
      'PAYMENT_OPERATION_INVALID',
      409
    );
  const payment = await deps.check({ runtime, scope, operationId });
  if (
    payment?.purpose !== 'vtu' ||
    payment.purchaseRef !== transactionId ||
    payment.amountKobo !== amountKobo
  )
    return invalid();
  // A re-check (empty proof) never reaches the pay step: the status check
  // above already reconciled from PiggyVest's record without sending.
  // An issued payment whose PIN proof was never spent is re-checked against
  // the purchase's live attempt, which leaves out expired ones: once it has
  // expired unpaid, the re-check ends instead of confirming forever (Codex P2).
  const expiredUnsent =
    recheck &&
    payment.state === 'issued' &&
    (
      await deps.findForPurchase({
        runtime,
        scope,
        purpose: 'vtu',
        purchaseRef: transactionId,
      })
    )?.operationId !== operationId;
  const result: WalletPayAnswer = expiredUnsent
    ? { status: 'expired' }
    : recheck
      ? { status: recheckStatus(payment.state) }
      : await deps.pay({
          runtime,
          scope,
          operationId,
          pinProof: input.pinProof ?? '',
        });
  if (ENDED_UNPAID.has(result.status))
    await closeUnpaidQuietly(deps.closeUnpaid, purchaseRef);
  if (result.status !== 'confirmed')
    return walletPayResponse(result, operationId, 'purchase');
  try {
    const delivery = await deliverVtuWalletPayment(
      { transactionId, operationId, amountKobo },
      { ...deps.delivery(runtime), fulfil: input.fulfil }
    );
    if (delivery.kind === 'result') return resultResponse(delivery.result);
    return walletPayAccepted(delivery.kind, operationId, extra);
  } catch (error) {
    if (error instanceof VtuWalletPaymentMismatchError) return invalid();
    throw error;
  }
}
