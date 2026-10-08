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
  if (claim.status !== 'claimed') return { status: claim.status };
  const reservation = schemas.reserved.parse(claim.reservation);
  if (
    reservation.operationId !== request.operationId ||
    reservation.goalId !== request.goalId ||
    reservation.amountKobo !== request.amountKobo ||
    reservation.sourceWalletId === reservation.destinationWalletId
  )
    throw new Error('Savings transfer ownership unavailable');
  let verified = false;
  try {
    const source = schemas.wallet.parse(
      await ports.retrieveWallet(reservation.sourceWalletId)
    );
    const destination = schemas.wallet.parse(
      await ports.retrieveWallet(reservation.destinationWalletId)
    );
    verified =
      source.id === reservation.sourceWalletId &&
      destination.id === reservation.destinationWalletId &&
      source.api_customer_id === reservation.providerCustomerId &&
      source.business_id === reservation.businessId &&
      destination.business_id === reservation.businessId &&
      source.balance >= reservation.amountKobo;
  } catch {
    verified = false;
  }
  if (!verified) {
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
