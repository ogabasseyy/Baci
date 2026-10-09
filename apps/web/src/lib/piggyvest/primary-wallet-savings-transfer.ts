import 'server-only';
import type { z } from 'zod';
import { piggyvestPrimarySavingsTransferSchemas as schemas } from '@/schemas/piggyvest-primary-savings-transfer';

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
  transfer: (reservation: Reservation) => Promise<{ accepted: true }>;
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
    // only a proven-absent reference resubmits. Anything else stays
    // pending for reconciliation, which settles submitted transfers.
    if (adoption.status === 'reclaimed') {
      await resubmitReclaimedSavingsDispatch(reservation, ports);
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

export async function resubmitReclaimedSavingsDispatch(
  reservation: Reservation,
  ports: Pick<Ports, 'lookupTransfer' | 'retrieveWallet' | 'transfer'>
): Promise<boolean> {
  // Only a proven-absent deterministic reference resubmits, so a late
  // provider submission for the reclaimed dispatch is never duplicated.
  // Returns whether a new transfer was submitted; any other outcome
  // stays pending for reconciliation, which settles submitted transfers.
  let observed: 'submitted' | 'absent' | 'uncertain';
  try {
    observed = await ports.lookupTransfer(reservation);
  } catch {
    observed = 'uncertain';
  }
  if (observed !== 'absent') return false;
  if (!(await verifyWallets(reservation, ports))) return false;
  try {
    const response = await ports.transfer(reservation);
    if (response.accepted !== true) throw new Error('Invalid acceptance');
  } catch {
    return false;
  }
  return true;
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
  } catch {
    return { status: 'pending' as const };
  }
  return { status: 'pending' as const };
}
