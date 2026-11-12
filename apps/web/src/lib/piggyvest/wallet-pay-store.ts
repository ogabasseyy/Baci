import 'server-only';
import { z } from 'zod';
import { piggyvestPrimaryWalletStoreSchemas } from '@/schemas/piggyvest-primary-wallet-store';
import { piggyvestWalletPaySchemas as schemas } from '@/schemas/piggyvest-wallet-pay';
import {
  WALLET_PAY_CUSTOMER_STATEMENTS as customerSql,
  WALLET_PAY_WORKER_STATEMENTS as workerSql,
} from './wallet-pay-statements';

type Execute = (
  statement: string,
  parameters: readonly string[]
) => Promise<{ rows: unknown }>;

// An empty proof is sent as-is: the database answers pin_refused 'missing'.
const pinProofOrMissing = z.union([z.literal(''), schemas.pinProof]);
const manageAction = z.enum(['dispatch', 'cancel', 'cancel_stale', 'release']);

/**
 * The customer side of wallet pay (authorizer login). Every call carries the
 * verified customer scope, which the database re-checks (assert_savings_scope)
 * at each transition.
 */
export function createWalletPayCustomerStore(input: {
  scope: unknown;
  execute: Execute;
}) {
  const scope = JSON.stringify(
    piggyvestPrimaryWalletStoreSchemas.scope.parse(input.scope)
  );
  return {
    async issue(request: unknown) {
      const parsed = schemas.issueRequest.parse(request);
      const result = await input.execute(customerSql.issue, [
        scope,
        JSON.stringify(parsed),
      ]);
      return schemas.issueRows.parse(result.rows)[0].result;
    },
    async readIssued(operationId: string) {
      const result = await input.execute(customerSql.readIssued, [
        scope,
        schemas.operationId.parse(operationId),
      ]);
      return schemas.issuedRows.parse(result.rows)[0].result;
    },
    // Spends the PIN proof and reserves in one database transaction.
    async reserve(operationId: string, pinProof: string) {
      const result = await input.execute(customerSql.reserve, [
        scope,
        JSON.stringify({ operationId: schemas.operationId.parse(operationId) }),
        pinProofOrMissing.parse(pinProof),
      ]);
      return schemas.reserveRows.parse(result.rows)[0].result;
    },
    async manage(operationId: string, action: z.infer<typeof manageAction>) {
      const result = await input.execute(customerSql.manage, [
        scope,
        schemas.operationId.parse(operationId),
        manageAction.parse(action),
      ]);
      return schemas.manageRows.parse(result.rows)[0].result;
    },
    async readStatus(operationId: string) {
      const result = await input.execute(customerSql.status, [
        scope,
        schemas.operationId.parse(operationId),
      ]);
      return schemas.statusRows.parse(result.rows)[0].result;
    },
  };
}

/**
 * The server-worker side (authorizer login, integration authority): delivery
 * claims and refunds. No customer is in the request; the database owns every
 * amount and wallet.
 */
export function createWalletPayWorkerStore(input: {
  integrationId: string;
  environment: 'staging' | 'production';
  execute: Execute;
}) {
  const binding = [z.uuid().parse(input.integrationId), input.environment];
  return {
    async claim(operationId: string) {
      const result = await input.execute(workerSql.claim, [
        ...binding,
        schemas.operationId.parse(operationId),
      ]);
      return schemas.claimRows.parse(result.rows)[0].result;
    },
    async finish(operationId: string, outcome: 'fulfilled' | 'failed') {
      const result = await input.execute(workerSql.finish, [
        ...binding,
        schemas.operationId.parse(operationId),
        z.enum(['fulfilled', 'failed']).parse(outcome),
      ]);
      return schemas.finishRows.parse(result.rows)[0].result;
    },
    async readOwedRefund(paymentId: string) {
      const result = await input.execute(workerSql.readOwedRefund, [
        ...binding,
        schemas.operationId.parse(paymentId),
      ]);
      return schemas.owedRefundRows.parse(result.rows)[0].result;
    },
    async manageRefund(refundId: string, action: 'dispatch' | 'release') {
      const result = await input.execute(workerSql.manageRefund, [
        ...binding,
        z.uuid().parse(refundId),
        z.enum(['dispatch', 'release']).parse(action),
      ]);
      return schemas.manageRows.parse(result.rows)[0].result;
    },
    async listWork(maxRows: number) {
      const result = await input.execute(workerSql.work, [
        ...binding,
        String(z.int().min(1).max(200).parse(maxRows)),
      ]);
      return schemas.workRows.parse(result.rows)[0].result;
    },
  };
}
