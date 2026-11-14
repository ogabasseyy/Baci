import 'server-only';
import { piggyvestWalletPaySchemas as schemas } from '@/schemas/piggyvest-wallet-pay';
import {
  verifyWalletPayProof,
  type WalletPaySettlementProof,
} from './wallet-pay-proof';

export type WalletPayTransferKind = 'payment' | 'refund';
export type WalletPayReconciliation =
  | 'confirmed'
  | 'released'
  | 'pending'
  | 'needs_review'
  | 'refunding';

export interface WalletPayReconciliationPorts {
  loadDispatched: (
    kind: WalletPayTransferKind,
    operationId: string,
    reference?: string
  ) => Promise<unknown>;
  queryProvider: (selection: {
    reference: string;
    walletId: string;
  }) => Promise<unknown>;
  settle: (
    kind: WalletPayTransferKind,
    proof: WalletPaySettlementProof
  ) => Promise<string>;
  release: (
    kind: WalletPayTransferKind,
    proof: WalletPaySettlementProof
  ) => Promise<string>;
}

function settled(answer: string): WalletPayReconciliation {
  if (answer === 'confirmed' || answer === 'duplicate') return 'confirmed';
  if (answer === 'needs_review' || answer === 'refunding') return answer;
  // 'deferred' (another attempt for the purchase is unresolved) and
  // 'conflict' (our books refused the record) decide nothing now.
  return 'pending';
}

/**
 * Concludes one dispatched transfer (payment or refund) from PiggyVest's own
 * record: re-query the sending wallet under our reference, bind the record to
 * what we reserved, then settle or release in the database. Every doubt
 * (nothing dispatched, a provider error, an unverified or non-terminal record)
 * is 'pending' and changes nothing; nothing here ever sends money.
 */
export async function reconcileWalletPayTransfer(
  input: {
    kind: WalletPayTransferKind;
    operationId: unknown;
    // A webhook's exact refund attempt (see loadDispatched).
    reference?: string;
    // The drain rethrows an exception (a provider, schema or database
    // failure) so the run counts it as failed and pages; customer polls
    // keep the quiet 'pending' (Codex P2).
    surfaceErrors?: boolean;
  },
  ports: WalletPayReconciliationPorts
): Promise<WalletPayReconciliation> {
  const operationId = schemas.operationId.parse(input.operationId);
  try {
    const stored = await ports.loadDispatched(
      input.kind,
      operationId,
      input.reference
    );
    if (stored === null) return 'pending';
    const reservation =
      input.kind === 'payment'
        ? schemas.paymentReservation.parse(stored)
        : schemas.refundReservation.parse(stored);
    if (reservation.operationId !== operationId) return 'pending';
    const response = await ports.queryProvider({
      reference: reservation.reference,
      walletId: reservation.sourceWalletId,
    });
    const verdict = verifyWalletPayProof(reservation, response);
    if (verdict.status === 'unverified') return 'pending';
    if (verdict.status === 'failed') {
      const answer = await ports.release(input.kind, verdict.proof);
      // A failed record that charged a fee is held for review, not released.
      if (answer === 'needs_review') return 'needs_review';
      return answer === 'released' || answer === 'duplicate'
        ? 'released'
        : 'pending';
    }
    return settled(await ports.settle(input.kind, verdict.proof));
  } catch (error) {
    // Nothing is concluded; the next poll, webhook or drain retries. Logged
    // (no ids or provider bodies) so a persistent failure is visible.
    console.warn(
      '[PiggyVest wallet pay] reconciliation inconclusive:',
      input.kind,
      error instanceof Error ? error.name : typeof error
    );
    if (input.surfaceErrors) throw error;
    return 'pending';
  }
}
