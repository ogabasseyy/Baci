import 'server-only';
import { isDefinitiveNoTransferRejection } from './primary-wallet-savings-transfer';
import type { TransferReferenceLookup } from './transfer-reference-lookup';

export interface SendOncePorts<R> {
  claimDispatch: () => Promise<boolean>;
  transfer: (reservation: R) => Promise<{ accepted: true }>;
  lookupTransfer: (reservation: R) => Promise<TransferReferenceLookup>;
  releaseAfterRejection: () => Promise<boolean>;
}

/**
 * The one POST a wallet-pay reference ever gets (payment or refund).
 *
 * The dispatch claim moves the record out of its pre-send state first, so a
 * second caller never reaches the POST. After the POST, only a definitive
 * provider rejection AND a TSQ lookup that finds nothing under the reference
 * releases the record; a timeout, a 5xx or any other doubt holds it
 * 'pending' for reconciliation. A TSQ 404 alone is never proof of absence
 * (docs/piggyvest-contract-evidence/2026-10-31.md, P2), and nothing here
 * ever re-posts.
 */
export async function sendWalletPayTransferOnce<R>(
  reservation: R,
  ports: SendOncePorts<R>
): Promise<'pending' | 'released'> {
  if (!(await ports.claimDispatch())) return 'pending';
  try {
    const response = await ports.transfer(reservation);
    if (response.accepted !== true) throw new Error('Invalid acceptance');
    return 'pending';
  } catch (error) {
    if (!isDefinitiveNoTransferRejection(error)) return 'pending';
    let lookup: TransferReferenceLookup;
    try {
      lookup = await ports.lookupTransfer(reservation);
    } catch {
      return 'pending';
    }
    if (lookup !== 'not_found') return 'pending';
    return (await ports.releaseAfterRejection()) ? 'released' : 'pending';
  }
}
