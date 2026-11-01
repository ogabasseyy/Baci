import 'server-only';
import type { z } from 'zod';
import { piggyvestPrimarySavingsTransferSchemas as schemas } from '@/schemas/piggyvest-primary-savings-transfer';
import { PiggyvestApiError } from './client';
import type { TransferReferenceLookup } from './transfer-reference-lookup';
import { emitPiggyvestWebhookAlert } from './webhook-alerts';

type Request = z.infer<typeof schemas.request>;
type Reservation = z.infer<typeof schemas.reserved>;
interface Ports {
  reserve: (
    request: Request
  ) => Promise<
    | { status: 'claimed'; reservation: unknown }
    | { status: 'pending' | 'confirmed' | 'insufficient' | 'conflict' }
  >;
  adoptPending: (
    operationId: string
  ) => Promise<
    | { status: 'adopted' | 'reclaimed'; reservation: Reservation }
    | { status: 'existing' }
  >;
  lookupTransfer: (
    reservation: Reservation
  ) => Promise<TransferReferenceLookup>;
  retrieveWallet: (walletId: string) => Promise<unknown>;
  cancelBeforeDispatch: (operationId: string) => Promise<void>;
  claimDispatch: (operationId: string) => Promise<boolean>;
  releaseAfterRejection: (operationId: string) => Promise<boolean>;
  transfer: (reservation: Reservation) => Promise<{ accepted: true }>;
}

/**
 * Definitive no-transfer rejections of a transfer POST: signals proving
 * the provider created nothing, so the hold may release once a lookup
 * also shows no transfer under the reference. (A 404 here is the POST's
 * own refusal, unrelated to a TSQ 404.) Auth failures are rejected before
 * processing; 400/404/422 refuse the request content; an explicit decline envelope
 * on 2xx was processed and refused. Everything else — transport and
 * timeout failures, 429/5xx, conflicts, success-shaped responses that
 * failed local parsing, and non-provider errors — stays ambiguous and
 * holds pending for reconciliation.
 */
export function isDefinitiveNoTransferRejection(error: unknown): boolean {
  if (!(error instanceof PiggyvestApiError)) return false;
  if (error.code === 'PIGGYVEST_AUTH_ERROR') return true;
  if (error.code !== 'PIGGYVEST_REQUEST_ERROR') return false;
  if (
    error.status !== null &&
    (error.status === 400 || error.status === 404 || error.status === 422)
  )
    return true;
  return (
    error.declined === true &&
    error.status !== null &&
    error.status >= 200 &&
    error.status < 300
  );
}

async function observeTransfer(
  reservation: Reservation,
  ports: Pick<Ports, 'lookupTransfer'>
): Promise<TransferReferenceLookup> {
  try {
    return await ports.lookupTransfer(reservation);
  } catch {
    return 'uncertain';
  }
}

async function releaseIfDefinitivelyRejected(
  operationId: string,
  reservation: Reservation,
  error: unknown,
  ports: Pick<Ports, 'lookupTransfer' | 'releaseAfterRejection'>
): Promise<boolean> {
  // The proof here is the provider's definitive rejection of the only
  // POST this reference ever gets (a reclaim never re-posts). The lookup
  // only guards against contrary evidence: a TSQ 404 is never proof of
  // absence on its own, and any record found under the reference, or an
  // uncertain lookup, keeps the hold pending for reconciliation.
  if (!isDefinitiveNoTransferRejection(error)) return false;
  if ((await observeTransfer(reservation, ports)) !== 'not_found') return false;
  return await ports.releaseAfterRejection(operationId);
}

export async function submitPrimaryWalletSavingsTransfer(
  input: unknown,
  ports: Ports
) {
  const request = schemas.request.parse(input);
  const claim = await ports.reserve(request);
  if (claim.status !== 'claimed') {
    // A pending operation may belong to a holder that died mid-flight:
    // adopt it and drive it instead of stranding the hold and the goal
    // slot. Fresh dispatches stay with their live holder ('existing').
    if (claim.status !== 'pending') return { status: claim.status };
    const adoption = await ports.adoptPending(request.operationId);
    if (adoption.status === 'existing') return { status: 'pending' as const };
    const reservation = schemas.reserved.parse(adoption.reservation);
    if (
      reservation.operationId !== request.operationId ||
      reservation.goalId !== request.goalId ||
      reservation.amountKobo !== request.amountKobo ||
      reservation.sourceWalletId === reservation.destinationWalletId
    )
      throw new Error('Savings transfer ownership unavailable');
    // A reclaimed dispatch may predate a provider submission that landed,
    // so it is never re-posted or released here; reconciliation settles
    // or releases it from provider evidence.
    if (adoption.status === 'reclaimed') {
      await reviewReclaimedSavingsDispatch(reservation, ports);
      return { status: 'pending' as const };
    }
    return await dispatchFresh(request, reservation, ports);
  }
  const reservation = schemas.reserved.parse(claim.reservation);
  if (
    reservation.operationId !== request.operationId ||
    reservation.goalId !== request.goalId ||
    reservation.amountKobo !== request.amountKobo ||
    reservation.sourceWalletId === reservation.destinationWalletId
  )
    throw new Error('Savings transfer ownership unavailable');
  return await dispatchFresh(request, reservation, ports);
}

/**
 * Observe a reclaimed dispatch — one whose dispatch stamp is older than
 * five minutes — WITHOUT resubmitting or releasing it. The sandbox answered
 * TSQ 404 for a 202-accepted transfer before it was indexed
 * (docs/piggyvest-contract-evidence/2026-10-31.md, P2: http_404 > pending >
 * successful in 9 polls), so the deterministic reference may carry money:
 * re-posting it could transfer twice, and releasing its hold could free
 * funds that moved. A reference still not found this far past the
 * indexing window is escalated to 'review' and raised for operator review
 * (the hold stays reserved and reconciliation can still settle it, but a
 * POST that never left a dead holder needs a person); every other
 * observation stays 'pending' for reconciliation, which settles or
 * releases from bound provider evidence. PiggyVest offers no positive
 * proof of absence, so no outcome here permits a new attempt.
 */
export async function reviewReclaimedSavingsDispatch(
  reservation: Reservation,
  ports: Pick<Ports, 'lookupTransfer'>
): Promise<'pending' | 'review'> {
  if ((await observeTransfer(reservation, ports)) !== 'not_found')
    return 'pending';
  emitPiggyvestWebhookAlert('PIGGYVEST_TRANSFER_NEEDS_REVIEW', {
    reason: 'savings_reference_not_found',
    operationId: reservation.operationId,
  });
  return 'review';
}

async function verifyWallets(
  reservation: Reservation,
  ports: Pick<Ports, 'retrieveWallet'>
) {
  try {
    const source = schemas.wallet.parse(
      await ports.retrieveWallet(reservation.sourceWalletId)
    );
    const destination = schemas.wallet.parse(
      await ports.retrieveWallet(reservation.destinationWalletId)
    );
    return (
      source.id === reservation.sourceWalletId &&
      destination.id === reservation.destinationWalletId &&
      source.api_customer_id === reservation.providerCustomerId &&
      // The destination wallet ID must still belong to the reserved
      // provider customer: ID reassignment at the provider (or a
      // poisoned reservation) would otherwise move funds into another
      // customer's wallet, and the transfer proof binds only the
      // source side so it cannot catch this later.
      destination.api_customer_id === reservation.providerCustomerId &&
      source.business_id === reservation.businessId &&
      destination.business_id === reservation.businessId &&
      source.balance >= reservation.amountKobo
    );
  } catch {
    return false;
  }
}

async function dispatchFresh(
  request: Request,
  reservation: Reservation,
  ports: Ports
) {
  if (!(await verifyWallets(reservation, ports))) {
    await ports.cancelBeforeDispatch(request.operationId);
    return { status: 'unavailable' as const };
  }
  if (!(await ports.claimDispatch(request.operationId)))
    return { status: 'pending' as const };
  try {
    const response = await ports.transfer(reservation);
    if (response.accepted !== true) throw new Error('Invalid acceptance');
  } catch (error) {
    // The dispatch claim already moved the operation out of 'reserved',
    // so the pre-dispatch cancel path cannot run here: only a definitive
    // provider rejection with no transfer found under the reference
    // releases the hold (reported cancelled); ambiguous failures hold
    // pending for reconciliation, which settles submitted transfers.
    if (
      await releaseIfDefinitivelyRejected(
        request.operationId,
        reservation,
        error,
        ports
      )
    )
      return { status: 'cancelled' as const };
    return { status: 'pending' as const };
  }
  return { status: 'pending' as const };
}
