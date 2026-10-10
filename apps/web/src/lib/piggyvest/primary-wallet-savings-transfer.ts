import 'server-only';
import type { z } from 'zod';
import { piggyvestPrimarySavingsTransferSchemas as schemas } from '@/schemas/piggyvest-primary-savings-transfer';
import { PiggyvestApiError } from './client';

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
  ) => Promise<'submitted' | 'absent' | 'uncertain'>;
  retrieveWallet: (walletId: string) => Promise<unknown>;
  cancelBeforeDispatch: (operationId: string) => Promise<void>;
  claimDispatch: (operationId: string) => Promise<boolean>;
  releaseAfterRejection: (operationId: string) => Promise<boolean>;
  transfer: (reservation: Reservation) => Promise<{ accepted: true }>;
}

/**
 * Definitive no-transfer rejections: signals proving the provider
 * created nothing, so the hold may release once a lookup also proves
 * the reference absent. Auth failures are rejected before processing;
 * 400/404/422 refuse the request content; an explicit decline envelope
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
): Promise<'submitted' | 'absent' | 'uncertain'> {
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
  // A definitive rejection alone is not enough: only a proven-absent
  // reference releases, so a late provider submission is never orphaned
  // by a freed hold. Uncertain or submitted stays pending.
  if (!isDefinitiveNoTransferRejection(error)) return false;
  if ((await observeTransfer(reservation, ports)) !== 'absent') return false;
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
    // A reclaimed dispatch may predate a provider submission that landed:
    // only a proven-absent reference resubmits. A definitive provider
    // rejection with a proven-absent reference releases the hold and
    // reports cancelled; anything else stays pending for reconciliation,
    // which settles submitted transfers.
    if (adoption.status === 'reclaimed') {
      const resubmission = await resubmitReclaimedSavingsDispatch(
        reservation,
        ports
      );
      return {
        status: (resubmission === 'released' ? 'cancelled' : 'pending') as
          | 'cancelled'
          | 'pending',
      };
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

export async function resubmitReclaimedSavingsDispatch(
  reservation: Reservation,
  ports: Pick<
    Ports,
    'lookupTransfer' | 'retrieveWallet' | 'transfer' | 'releaseAfterRejection'
  >
): Promise<'submitted' | 'released' | 'pending'> {
  // Only a proven-absent deterministic reference resubmits, so a late
  // provider submission for the reclaimed dispatch is never duplicated.
  // A definitive provider rejection with a still-absent reference
  // releases the hold ('released') instead of stranding it; any other
  // outcome stays pending for reconciliation, which settles submitted
  // transfers.
  if ((await observeTransfer(reservation, ports)) !== 'absent')
    return 'pending';
  if (!(await verifyWallets(reservation, ports))) return 'pending';
  try {
    const response = await ports.transfer(reservation);
    if (response.accepted !== true) throw new Error('Invalid acceptance');
  } catch (error) {
    if (
      await releaseIfDefinitivelyRejected(
        reservation.operationId,
        reservation,
        error,
        ports
      )
    )
      return 'released';
    return 'pending';
  }
  return 'submitted';
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
    // provider rejection with a proven-absent reference releases the
    // hold (reported cancelled); ambiguous failures hold pending for
    // reconciliation, which settles submitted transfers.
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
