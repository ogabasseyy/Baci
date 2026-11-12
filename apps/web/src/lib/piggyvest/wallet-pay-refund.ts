import 'server-only';
import {
  piggyvestWalletPaySchemas as schemas,
  type WalletPayRefundReservation,
} from '@/schemas/piggyvest-wallet-pay';
import type { TransferReferenceLookup } from './transfer-reference-lookup';
import { sendWalletPayTransferOnce } from './wallet-pay-send-once';

export interface WalletRefundPorts {
  // From server configuration only; must equal the refund's source.
  collectionWalletId: string;
  readOwed: (paymentId: string) => Promise<unknown>;
  retrieveWallet: (walletId: string) => Promise<unknown>;
  claimDispatch: (refundId: string) => Promise<boolean>;
  releaseAfterRejection: (refundId: string) => Promise<boolean>;
  lookupTransfer: (
    reservation: WalletPayRefundReservation
  ) => Promise<TransferReferenceLookup>;
  transfer: (
    reservation: WalletPayRefundReservation
  ) => Promise<{ accepted: true }>;
}

async function checkWallets(
  refund: WalletPayRefundReservation,
  ports: Pick<WalletRefundPorts, 'retrieveWallet' | 'collectionWalletId'>
): Promise<'ok' | 'unfunded' | 'unavailable'> {
  if (refund.sourceWalletId !== ports.collectionWalletId) return 'unavailable';
  try {
    const collection = schemas.wallet.parse(
      await ports.retrieveWallet(refund.sourceWalletId)
    );
    const main = schemas.wallet.parse(
      await ports.retrieveWallet(refund.destinationWalletId)
    );
    const bound =
      collection.id === refund.sourceWalletId &&
      collection.api_customer_id === undefined &&
      collection.business_id === refund.businessId &&
      main.id === refund.destinationWalletId &&
      main.api_customer_id === refund.providerCustomerId &&
      main.business_id === refund.businessId;
    if (!bound) return 'unavailable';
    return collection.balance >= refund.amountKobo ? 'ok' : 'unfunded';
  } catch {
    return 'unavailable';
  }
}

/**
 * Sends the owed refund of one payment, at most once per refund attempt. The
 * database decides whether a refund is owed, its amount, both wallets and its
 * reference; this only checks them against PiggyVest and POSTs. Nothing is
 * claimed while the wallets do not check out (the refund stays owed and the
 * next drain tries again; 'unfunded' means the collection wallet was swept
 * below the refund, which the daily report shows). A proven rejection
 * releases the attempt, and the database opens the next one under a fresh
 * reference.
 */
export async function driveWalletRefund(
  input: { paymentId: unknown },
  ports: WalletRefundPorts
): Promise<'none' | 'pending' | 'released' | 'unavailable' | 'unfunded'> {
  const paymentId = schemas.operationId.parse(input.paymentId);
  const answer = await ports.readOwed(paymentId);
  if (answer === null) return 'none';
  const refund = schemas.refundReservation.parse(answer);
  if (
    refund.operationId !== paymentId ||
    refund.sourceWalletId === refund.destinationWalletId
  )
    throw new Error('Wallet refund ownership unavailable');
  const wallets = await checkWallets(refund, ports);
  if (wallets !== 'ok') return wallets;
  return await sendWalletPayTransferOnce(refund, {
    claimDispatch: () => ports.claimDispatch(refund.refundId),
    transfer: ports.transfer,
    lookupTransfer: ports.lookupTransfer,
    releaseAfterRejection: () => ports.releaseAfterRejection(refund.refundId),
  });
}
