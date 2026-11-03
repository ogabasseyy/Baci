import 'server-only';
import type { z } from 'zod';
import {
  GOAL_CANCEL_MAX_AMOUNT_KOBO,
  piggyvestGoalCancelSchemas as schemas,
} from '@/schemas/piggyvest-goal-cancel';
import { isDefinitiveNoTransferRejection } from './primary-wallet-savings-transfer';
import type { TransferReferenceLookup } from './transfer-reference-lookup';

type Reservation = z.infer<typeof schemas.reservation>;
type Claim =
  | { status: 'claimed'; reservation: unknown }
  | {
      status:
        | 'pending'
        | 'confirmed'
        | 'conflict'
        | 'expired'
        | 'busy'
        | 'needs_review';
    }
  | { status: 'pin_refused'; reason: string };

interface Ports {
  reserve: (request: { goalId: string; operationId: string }) => Promise<Claim>;
  retrieveWallet: (walletId: string) => Promise<unknown>;
  claimDispatch: (operationId: string, amountKobo: number) => Promise<boolean>;
  cancelBeforeDispatch: (operationId: string) => Promise<boolean>;
  lookupTransfer: (
    reservation: Reservation & { amountKobo: number }
  ) => Promise<TransferReferenceLookup>;
  releaseAfterRejection: (operationId: string) => Promise<boolean>;
  transfer: (input: {
    reservation: Reservation;
    amountKobo: number;
  }) => Promise<{ accepted: true }>;
}

/**
 * Reads both wallets at PiggyVest and returns the goal wallet's balance, the
 * amount to move. The balance is whatever PiggyVest reports now, interest
 * included; nothing here computes it. Null means a wallet failed a check.
 */
async function readGoalBalance(
  reservation: Reservation,
  ports: Pick<Ports, 'retrieveWallet'>
): Promise<number | null> {
  try {
    const goalWallet = schemas.wallet.parse(
      await ports.retrieveWallet(reservation.sourceWalletId)
    );
    const mainWallet = schemas.wallet.parse(
      await ports.retrieveWallet(reservation.destinationWalletId)
    );
    const bound =
      goalWallet.id === reservation.sourceWalletId &&
      mainWallet.id === reservation.destinationWalletId &&
      goalWallet.api_customer_id === reservation.providerCustomerId &&
      mainWallet.api_customer_id === reservation.providerCustomerId &&
      goalWallet.business_id === reservation.businessId &&
      mainWallet.business_id === reservation.businessId;
    return bound ? goalWallet.balance : null;
  } catch {
    return null;
  }
}

/**
 * Frees a reservation that never dispatched. A thrown release is retried once
 * so a transient database error does not leave the attempt reserved (and
 * funding and new cancels blocked) until the stale sweep; if both tries throw,
 * the stale-reservation sweep in the status check still releases it.
 */
async function releaseReservation(
  operationId: string,
  ports: Pick<Ports, 'cancelBeforeDispatch'>
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await ports.cancelBeforeDispatch(operationId);
      return;
    } catch {
      // Retry once; the stale sweep is the backstop.
    }
  }
}

async function releaseIfDefinitivelyRejected(
  reservation: Reservation,
  amountKobo: number,
  error: unknown,
  ports: Pick<Ports, 'lookupTransfer' | 'releaseAfterRejection'>
): Promise<boolean> {
  // The provider refused the only POST this reference gets (a later attempt
  // takes a fresh reference). A lookup guards
  // against contrary evidence: a TSQ 404 right after a submit is "not indexed
  // yet" as often as "never sent", so only a not_found lookup AFTER a
  // definitive refusal frees the attempt; anything else holds it pending.
  if (!isDefinitiveNoTransferRejection(error)) return false;
  let lookup: TransferReferenceLookup;
  try {
    lookup = await ports.lookupTransfer({ ...reservation, amountKobo });
  } catch {
    return false;
  }
  if (lookup !== 'not_found') return false;
  return await ports.releaseAfterRejection(reservation.operationId);
}

/**
 * Cancels a goal by moving its full PiggyVest balance to the main wallet.
 *
 * The provider reference is per goal ('pvb-cancel-<goalId>'), so a double tap
 * or a retry can never move money twice. It only takes a new suffix after a
 * dispatched attempt was released, and the database assigns it. This function POSTs at most once per
 * reservation: a replay that finds the attempt already reserved or dispatched
 * returns pending and leaves the outcome to a status check, never a resend.
 * After a timeout or any ambiguous failure the attempt stays pending too.
 */
export async function submitGoalCancel(
  input: unknown,
  ports: Ports
): Promise<
  | { status: 'pin_refused'; reason: string }
  | {
      status:
        | 'pending'
        | 'confirmed'
        | 'conflict'
        | 'expired'
        | 'busy'
        | 'needs_review'
        | 'unavailable'
        | 'empty'
        | 'too_large'
        | 'released';
    }
> {
  const request = {
    goalId: schemas.goalId.parse((input as { goalId?: unknown }).goalId),
    operationId: schemas.operationId.parse(
      (input as { operationId?: unknown }).operationId
    ),
  };
  const claim = await ports.reserve(request);
  if (claim.status === 'pin_refused')
    return { status: 'pin_refused', reason: claim.reason };
  if (claim.status !== 'claimed') return { status: claim.status };
  const reservation = schemas.reservation.parse(claim.reservation);
  if (
    reservation.operationId !== request.operationId ||
    reservation.goalId !== request.goalId ||
    reservation.sourceWalletId === reservation.destinationWalletId
  )
    throw new Error('Goal cancel ownership unavailable');
  const amountKobo = await readGoalBalance(reservation, ports);
  if (amountKobo === null) {
    await releaseReservation(request.operationId, ports);
    return { status: 'unavailable' };
  }
  if (amountKobo < 1) {
    await releaseReservation(request.operationId, ports);
    return { status: 'empty' };
  }
  if (amountKobo > GOAL_CANCEL_MAX_AMOUNT_KOBO) {
    // Above the shared dispatch ceiling: release the reservation now so the
    // attempt is never left reserved with the PIN already spent.
    await releaseReservation(request.operationId, ports);
    return { status: 'too_large' };
  }
  if (!(await ports.claimDispatch(request.operationId, amountKobo)))
    return { status: 'pending' };
  try {
    const response = await ports.transfer({ reservation, amountKobo });
    if (response.accepted !== true) throw new Error('Invalid acceptance');
  } catch (error) {
    if (
      await releaseIfDefinitivelyRejected(reservation, amountKobo, error, ports)
    )
      return { status: 'released' };
  }
  return { status: 'pending' };
}
