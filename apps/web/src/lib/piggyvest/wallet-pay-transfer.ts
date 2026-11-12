import 'server-only';
import {
  piggyvestWalletPaySchemas as schemas,
  type WalletPayPaymentReservation,
} from '@/schemas/piggyvest-wallet-pay';
import type { TransferReferenceLookup } from './transfer-reference-lookup';
import {
  isRestricted,
  sendWalletPayTransferOnce,
} from './wallet-pay-send-once';

type ReserveAnswer =
  | { status: 'claimed'; reservation: unknown }
  | {
      status:
        | 'pending'
        | 'confirmed'
        | 'needs_review'
        | 'released'
        | 'expired'
        | 'conflict'
        | 'unavailable';
    }
  | { status: 'pin_refused'; reason: string };

export interface WalletPaymentPorts {
  // From the server's own configuration (PIGGYVEST_COLLECTION_WALLET_ID),
  // never from the request. Must equal the reservation's destination.
  collectionWalletId: string;
  reserve: (operationId: string) => Promise<ReserveAnswer>;
  retrieveWallet: (walletId: string) => Promise<unknown>;
  claimDispatch: (operationId: string) => Promise<boolean>;
  cancelBeforeDispatch: (operationId: string) => Promise<boolean>;
  releaseAfterRejection: (operationId: string) => Promise<boolean>;
  lookupTransfer: (
    reservation: WalletPayPaymentReservation
  ) => Promise<TransferReferenceLookup>;
  transfer: (
    reservation: WalletPayPaymentReservation
  ) => Promise<{ accepted: true }>;
}

export type WalletPaymentSubmission =
  | { status: 'pin_refused'; reason: string }
  | {
      status:
        | 'pending'
        | 'confirmed'
        | 'needs_review'
        | 'released'
        | 'expired'
        | 'conflict'
        | 'unavailable'
        | 'insufficient';
    };

/**
 * Both wallets as PiggyVest reports them now. The source must be this
 * customer's main wallet and able to cover the amount; the destination must be
 * the configured collection wallet: our business, and bound to no customer
 * (a business wallet carries no api_customer_id, sandbox 2026-11-02
 * house_wallet_unbound_to_customer). 'unavailable' covers every binding miss.
 */
async function checkWallets(
  reservation: WalletPayPaymentReservation,
  ports: Pick<WalletPaymentPorts, 'retrieveWallet' | 'collectionWalletId'>
): Promise<'ok' | 'insufficient' | 'unavailable'> {
  if (reservation.destinationWalletId !== ports.collectionWalletId)
    return 'unavailable';
  try {
    const source = schemas.wallet.parse(
      await ports.retrieveWallet(reservation.sourceWalletId)
    );
    const destination = schemas.wallet.parse(
      await ports.retrieveWallet(reservation.destinationWalletId)
    );
    const bound =
      source.id === reservation.sourceWalletId &&
      source.api_customer_id === reservation.providerCustomerId &&
      source.business_id === reservation.businessId &&
      destination.id === reservation.destinationWalletId &&
      destination.api_customer_id === undefined &&
      destination.business_id === reservation.businessId;
    if (!bound || isRestricted(source) || isRestricted(destination))
      return 'unavailable';
    return source.balance >= reservation.amountKobo ? 'ok' : 'insufficient';
  } catch {
    return 'unavailable';
  }
}

/**
 * Pays for one purchase from the customer's PiggyVest main wallet: spend the
 * PIN proof and reserve (one database transaction), check both wallets at
 * PiggyVest, then POST the transfer at most once. A replay of any operation
 * that got past 'issued' never POSTs again: its outcome comes from
 * reconciliation, through the status path.
 */
export async function submitWalletPayment(
  input: { operationId: unknown },
  ports: WalletPaymentPorts
): Promise<WalletPaymentSubmission> {
  const operationId = schemas.operationId.parse(input.operationId);
  const claim = await ports.reserve(operationId);
  if (claim.status === 'pin_refused')
    return { status: 'pin_refused', reason: claim.reason };
  if (claim.status !== 'claimed') return { status: claim.status };
  const reservation = schemas.paymentReservation.parse(claim.reservation);
  if (
    reservation.operationId !== operationId ||
    reservation.sourceWalletId === reservation.destinationWalletId
  )
    throw new Error('Wallet payment ownership unavailable');
  const wallets = await checkWallets(reservation, ports);
  if (wallets !== 'ok') {
    // Nothing was sent; free the reservation so the customer can try again.
    await ports.cancelBeforeDispatch(operationId).catch(() => false);
    return { status: wallets };
  }
  const outcome = await sendWalletPayTransferOnce(reservation, {
    claimDispatch: () => ports.claimDispatch(operationId),
    transfer: ports.transfer,
    lookupTransfer: ports.lookupTransfer,
    releaseAfterRejection: () => ports.releaseAfterRejection(operationId),
  });
  return { status: outcome };
}
