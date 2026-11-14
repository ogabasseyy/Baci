import 'server-only';
import type { FulfilledVtuResult } from '@/lib/vtu-fulfillment';

type ClaimAnswer =
  | {
      status: 'claimed' | 'reclaimed';
      purpose: string;
      purchaseRef: string;
      amountKobo: number;
      claimToken: string;
    }
  | {
      status:
        | 'not_found'
        | 'not_confirmed'
        | 'busy'
        | 'fulfilled'
        | 'refund_owed'
        | 'refunded';
    };

export interface DeliverVtuWalletPaymentDeps {
  claim: (operationId: string) => Promise<ClaimAnswer>;
  finish: (
    operationId: string,
    outcome: 'fulfilled' | 'failed',
    claimToken: string
  ) => Promise<string>;
  refund: (operationId: string) => Promise<unknown>;
  deliveryState: (
    operationId: string
  ) => Promise<'success' | 'failed' | 'processing' | 'mismatch'>;
  /** Runs (walletPayClaimed) or reads (not claimed) the VTU purchase. */
  fulfil: (walletPayClaimed: boolean) => Promise<FulfilledVtuResult>;
}

export type VtuDelivery =
  | { kind: 'payment_pending' }
  | { kind: 'delivering' }
  | { kind: 'result'; result: FulfilledVtuResult };

/** A definitive wrong-purchase answer (409), never a transient unknown. */
export class VtuWalletPaymentMismatchError extends Error {
  constructor() {
    super('Wallet payment does not belong to this VTU purchase');
    this.name = 'VtuWalletPaymentMismatchError';
  }
}

async function record(
  deps: DeliverVtuWalletPaymentDeps,
  operationId: string,
  claimToken: string,
  outcome: 'fulfilled' | 'failed'
) {
  const answer = await deps.finish(operationId, outcome, claimToken);
  const expected = outcome === 'fulfilled' ? 'fulfilled' : 'refund_owed';
  if (answer !== expected && answer !== 'duplicate')
    throw new Error('VTU wallet payment outcome could not be recorded');
  // Best effort: the drain sends any refund still owed.
  if (outcome === 'failed') await deps.refund(operationId).catch(() => null);
}

/**
 * Airtime, data or a bill paid from the PiggyVest wallet, final step: vend
 * once the payment is CONFIRMED, exactly once (the delivery claim), and owe
 * exactly one refund if the vend fails definitively. A reclaimed claim (a
 * delivery that died mid-flight) never vends again: the stored purchase
 * decides, exactly as the drain does. A vend still processing keeps its
 * claim, so the drain settles it from the VTU requery later.
 */
export async function deliverVtuWalletPayment(
  input: { transactionId: string; operationId: string; amountKobo: number },
  deps: DeliverVtuWalletPaymentDeps
): Promise<VtuDelivery> {
  const { operationId } = input;
  const claim = await deps.claim(operationId);
  if (claim.status === 'not_found' || claim.status === 'not_confirmed')
    return { kind: 'payment_pending' };
  if (claim.status === 'busy') return { kind: 'delivering' };
  if (claim.status !== 'claimed' && claim.status !== 'reclaimed')
    return { kind: 'result', result: await deps.fulfil(false) };
  if (
    claim.purpose !== 'vtu' ||
    claim.purchaseRef !== input.transactionId ||
    claim.amountKobo !== input.amountKobo
  )
    throw new VtuWalletPaymentMismatchError();

  if (claim.status === 'reclaimed') {
    const state = await deps.deliveryState(operationId);
    if (state === 'mismatch') throw new VtuWalletPaymentMismatchError();
    if (state !== 'processing') {
      await record(
        deps,
        operationId,
        claim.claimToken,
        state === 'success' ? 'fulfilled' : 'failed'
      );
      return { kind: 'result', result: await deps.fulfil(false) };
    }
    // Still processing: reconcile from the provider (or re-drive a pending
    // purchase interrupted mid-vend, under the same provider reference) as
    // the claim holder, and record a final answer it reaches now, rather
    // than waiting for another claim lapse (Codex P2). Only the claim holder
    // may re-drive such a purchase (Muse high).
    const reconciled = await deps.fulfil(true);
    if (reconciled.status === 'successful')
      await record(deps, operationId, claim.claimToken, 'fulfilled');
    else if (reconciled.status === 'failed')
      await record(deps, operationId, claim.claimToken, 'failed');
    return { kind: 'result', result: reconciled };
  }

  const result = await deps.fulfil(true);
  if (result.status === 'successful')
    await record(deps, operationId, claim.claimToken, 'fulfilled');
  else if (result.status === 'failed')
    await record(deps, operationId, claim.claimToken, 'failed');
  return { kind: 'result', result };
}
