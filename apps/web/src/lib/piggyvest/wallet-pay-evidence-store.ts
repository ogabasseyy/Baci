import 'server-only';
import { z } from 'zod';
import { piggyvestWalletPaySchemas as schemas } from '@/schemas/piggyvest-wallet-pay';
import type { WalletPaySettlementProof } from './wallet-pay-proof';
import type { WalletPayTransferKind } from './wallet-pay-reconciliation';
import { WALLET_PAY_EVIDENCE_STATEMENTS as sql } from './wallet-pay-statements';

type Execute = (
  statement: string,
  parameters: readonly string[]
) => Promise<{ rows: unknown }>;

/**
 * The evidence-login side of wallet pay: it can only conclude what PiggyVest
 * already did (settle or release from a verified record) and read dispatched
 * transfers. It holds no dispatch handle.
 */
export function createWalletPayEvidenceStore(input: {
  integrationId: string;
  environment: 'staging' | 'production';
  execute: Execute;
}) {
  const binding = [z.uuid().parse(input.integrationId), input.environment];
  async function run(statement: string, value: string) {
    const result = await input.execute(statement, [...binding, value]);
    return result.rows;
  }
  return {
    // A refund webhook names one attempt: its reference loads exactly that
    // attempt. Without it, the attempt in flight (else the latest) is used.
    async loadDispatched(
      kind: WalletPayTransferKind,
      operationId: string,
      reference?: string
    ) {
      const id = schemas.operationId.parse(operationId);
      if (kind === 'refund' && reference !== undefined)
        return schemas.refundDispatchedRows.parse(
          await run(sql.readRefundAttempt, schemas.reference.parse(reference))
        )[0].result;
      if (kind === 'payment')
        return schemas.paymentDispatchedRows.parse(
          await run(sql.readDispatchedPayment, id)
        )[0].result;
      return schemas.refundDispatchedRows.parse(
        await run(sql.readDispatchedRefund, id)
      )[0].result;
    },
    async findByReference(reference: string) {
      // Not a wallet-pay reference: never ours, never queried.
      if (!schemas.reference.safeParse(reference).success) return null;
      return schemas.transferByReferenceRows.parse(
        await run(sql.findByReference, reference)
      )[0].result;
    },
    async settle(kind: WalletPayTransferKind, proof: WalletPaySettlementProof) {
      const body = JSON.stringify(proof);
      if (kind === 'payment')
        return schemas.settlePaymentRows.parse(
          await run(sql.settlePayment, body)
        )[0].result;
      return schemas.settleRefundRows.parse(
        await run(sql.settleRefund, body)
      )[0].result;
    },
    async release(
      kind: WalletPayTransferKind,
      proof: WalletPaySettlementProof
    ) {
      const statement =
        kind === 'payment' ? sql.releasePayment : sql.releaseRefund;
      return schemas.releaseRows.parse(
        await run(statement, JSON.stringify(proof))
      )[0].result;
    },
    async readReconciliation() {
      const rows = await run(sql.reconciliation, '{}');
      return z
        .array(z.object({ result: z.unknown() }))
        .length(1)
        .parse(rows)[0].result;
    },
  };
}
