import 'server-only';
import { piggyvestPrimaryInflowRuntimeSchema } from '@/schemas/piggyvest-primary-inflow-runtime';
import { piggyvestPrimarySavingsTransferSchemas as schemas } from '@/schemas/piggyvest-primary-savings-transfer';
import type { verifyPrimaryWalletSavingsProof } from './primary-wallet-savings-proof';

type Proof = Extract<
  ReturnType<typeof verifyPrimaryWalletSavingsProof>,
  { status: 'verified' }
>;
type Execute = (
  statement: string,
  parameters: readonly string[]
) => Promise<{ rows: unknown }>;

export function createPrimaryWalletSavingsReconciliationStore(input: {
  integrationId: string;
  environment: 'staging' | 'production';
  execute: Execute;
}) {
  const binding = piggyvestPrimaryInflowRuntimeSchema
    .pick({ integrationId: true, environment: true })
    .parse({
      integrationId: input.integrationId,
      environment: input.environment,
    });
  async function execute(statement: string, selection: string) {
    const result = await input.execute(statement, [
      binding.integrationId,
      binding.environment,
      selection,
    ]);
    if (!Array.isArray(result.rows) || result.rows.length !== 1)
      throw new Error('Savings settlement unavailable');
    const row: unknown = result.rows[0];
    if (row === null || typeof row !== 'object' || !('result' in row))
      throw new Error('Savings settlement unavailable');
    return row.result;
  }
  return {
    async loadDispatched(operationId: string) {
      const selection = schemas.request.shape.operationId.parse(operationId);
      const result = await execute(
        'SELECT piggyvest_primary.read_dispatched_savings($1::uuid,$2::text,$3::uuid) AS result',
        selection
      );
      return result === null ? null : schemas.reserved.parse(result);
    },
    async settle(
      proof: Proof
    ): Promise<'confirmed' | 'duplicate' | 'conflict'> {
      const { status: _status, ...receipt } = proof;
      const result = await execute(
        'SELECT piggyvest_primary.settle_savings($1::uuid,$2::text,$3::jsonb) AS result',
        JSON.stringify(receipt)
      );
      if (
        result !== 'confirmed' &&
        result !== 'duplicate' &&
        result !== 'conflict'
      )
        throw new Error('Savings settlement unavailable');
      return result;
    },
  };
}
