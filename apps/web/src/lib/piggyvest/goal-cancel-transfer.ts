import 'server-only';
import type { z } from 'zod';
import { piggyvestGoalCancelSchemas as schemas } from '@/schemas/piggyvest-goal-cancel';
import { isDefinitiveNoTransferRejection } from './primary-wallet-savings-transfer';
import type { TransferReferenceLookup } from './transfer-reference-lookup';

type Reservation = z.infer<typeof schemas.reservation>;
type Claim =
  | { status: 'claimed'; reservation: unknown }
  | { status: 'pending' | 'confirmed' | 'conflict' | 'expired' | 'busy' }
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

async function releaseIfDefinitivelyRejected(
  reservation: Reservation,
  amountKobo: number,
  error: unknown,
  ports: Pick<Ports, 'lookupTransfer' | 'releaseAfterRejection'>
): Promise<boolean> {
  // The provider refused the only POST this reference gets. A lookup guards
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
 * or a retry can never move money twice. This function POSTs at most once per
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
        | 'unavailable'
        | 'empty'
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
    await ports.cancelBeforeDispatch(request.operationId).catch(() => false);
    return { status: 'unavailable' };
  }
  if (amountKobo < 1) {
    await ports.cancelBeforeDispatch(request.operationId).catch(() => false);
    return { status: 'empty' };
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
