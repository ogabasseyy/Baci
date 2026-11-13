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
    // This customer's live payment for one purchase, or null.
    async readForPurchase(purpose: 'imei_check' | 'vtu', purchaseRef: string) {
      const result = await input.execute(customerSql.forPurchase, [
        scope,
        JSON.stringify({
          purpose: schemas.purpose.parse(purpose),
          purchaseRef: schemas.purchaseRef.parse(purchaseRef),
        }),
      ]);
      return schemas.forPurchaseRows.parse(result.rows)[0].result;
    },
    // Whether this customer's wallet flow ever issued a payment for one
    // purchase, expired or released attempts included.
    async wasAttempted(purpose: 'imei_check' | 'vtu', purchaseRef: string) {
      const result = await input.execute(customerSql.attempted, [
        scope,
        JSON.stringify({
          purpose: schemas.purpose.parse(purpose),
          purchaseRef: schemas.purchaseRef.parse(purchaseRef),
        }),
      ]);
      return schemas.manageRows.parse(result.rows)[0].result;
    },
    // Closes this customer's PiggyVest-paid VTU purchase whose payment ended
    // unpaid (no payment for it live or paid). True when it was closed.
    async closeUnpaidVtu(transactionId: string) {
      const result = await input.execute(customerSql.closeUnpaidVtu, [
        scope,
        JSON.stringify({ transactionId: z.uuid().parse(transactionId) }),
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
    // claimToken: from the claim this worker holds; a stale one is refused.
    async finish(
      operationId: string,
      outcome: 'fulfilled' | 'failed',
      claimToken: string
    ) {
      const result = await input.execute(workerSql.finish, [
        ...binding,
        schemas.operationId.parse(operationId),
        z.enum(['fulfilled', 'failed']).parse(outcome),
        z.uuid().parse(claimToken),
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
    // Releases a reservation that was never sent (older than 5 minutes).
    async releaseStale(operationId: string) {
      const result = await input.execute(workerSql.releaseStale, [
        ...binding,
        schemas.operationId.parse(operationId),
      ]);
      return schemas.manageRows.parse(result.rows)[0].result;
    },
    // Whether the IMEI check this claimed payment bought was already saved.
    async isImeiDelivered(operationId: string) {
      const result = await input.execute(workerSql.imeiDelivered, [
        ...binding,
        schemas.operationId.parse(operationId),
      ]);
      return schemas.manageRows.parse(result.rows)[0].result;
    },
    // How a claimed VTU payment's purchase ended (a never-vended pending row
    // is closed as failed in the same call).
    async vtuDeliveryState(operationId: string) {
      const result = await input.execute(workerSql.vtuDeliveryState, [
        ...binding,
        schemas.operationId.parse(operationId),
      ]);
      return schemas.vtuDeliveryRows.parse(result.rows)[0].result;
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
