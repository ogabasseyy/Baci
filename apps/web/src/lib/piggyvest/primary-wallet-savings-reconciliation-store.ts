import 'server-only';
import type { z } from 'zod';
import { piggyvestPrimaryInflowRuntimeSchema } from '@/schemas/piggyvest-primary-inflow-runtime';
import { piggyvestPrimarySavingsTransferSchemas as schemas } from '@/schemas/piggyvest-primary-savings-transfer';
import { primaryWalletSavingsReconciliationCheckpointSchemas as checkpointSchemas } from '@/schemas/primary-wallet-savings-reconciliation-checkpoint';
import type { verifyPrimaryWalletSavingsProof } from './primary-wallet-savings-proof';

type Proof = Extract<
  ReturnType<typeof verifyPrimaryWalletSavingsProof>,
  { status: 'verified' }
>;
type FailedProof = Extract<
  ReturnType<typeof verifyPrimaryWalletSavingsProof>,
  { status: 'failed' }
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
    async findDispatchedByReference(reference: string) {
      const selection = schemas.reserved.shape.reference.parse(reference);
      const result = await execute(
        'SELECT piggyvest_primary.find_dispatched_savings_by_reference($1::uuid,$2::text,$3::text) AS result',
        selection
      );
      if (result === null) return null;
      // Detached rows (account deleted, goal link nulled) are retained
      // for manual recovery, not auto-reconciliation: settling one would
      // credit a deleted goal. Report them as unmatched so the webhook
      // acks instead of 503-looping on an op reconciliation can never
      // confirm — while genuinely corrupt rows still throw loudly.
      const detached = schemas.reserved
        .extend({ goalId: schemas.reserved.shape.goalId.nullable() })
        .safeParse(result);
      if (detached.success && detached.data.goalId === null) return null;
      return schemas.reserved.parse(result);
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
    async release(
      proof: FailedProof
    ): Promise<'released' | 'duplicate' | 'conflict'> {
      const { status: _status, ...receipt } = proof;
      const result = await execute(
        'SELECT piggyvest_primary.release_failed_savings($1::uuid,$2::text,$3::jsonb) AS result',
        JSON.stringify(receipt)
      );
      if (
        result !== 'released' &&
        result !== 'duplicate' &&
        result !== 'conflict'
      )
        throw new Error('Savings settlement unavailable');
      return result;
    },
    async withIdentityCheckpoint<T>(
      operationId: string,
      work: (checkpoint: {
        state: z.infer<typeof checkpointSchemas.state>;
        save: (
          state: z.infer<typeof checkpointSchemas.state>
        ) => Promise<boolean>;
        reset: () => Promise<boolean>;
      }) => Promise<T>
    ): Promise<T | null> {
      const selection = schemas.request.shape.operationId.parse(operationId);
      const raw = await execute(
        'SELECT piggyvest_primary.claim_savings_reconciliation_checkpoint($1::uuid,$2::text,$3::uuid) AS result',
        selection
      );
      const claim = checkpointSchemas.claim.safeParse(raw);
      if (!claim.success) return null;
      const acquired = claim.data;
      if (acquired.status !== 'acquired') return null;
      let released = false;
      const finish = async (reset: boolean) => {
        const result = await execute(
          'SELECT piggyvest_primary.finish_savings_reconciliation_checkpoint($1::uuid,$2::text,$3::jsonb) AS result',
          JSON.stringify({
            operationId: selection,
            claimToken: acquired.claimToken,
            reset,
          })
        );
        if (result !== true)
          throw new Error('Savings checkpoint lease unavailable');
        released = true;
        return true;
      };
      try {
        return await work({
          state: acquired.state,
          save: async (state) => {
            const validated = checkpointSchemas.state.safeParse(state);
            if (!validated.success) throw new Error('Invalid checkpoint state');
            const result = await execute(
              'SELECT piggyvest_primary.save_savings_reconciliation_checkpoint($1::uuid,$2::text,$3::jsonb) AS result',
              JSON.stringify({
                operationId: selection,
                claimToken: acquired.claimToken,
                ...validated.data,
              })
            );
            if (typeof result !== 'boolean')
              throw new Error('Checkpoint save unavailable');
            return result;
          },
          reset: () => finish(true),
        });
      } finally {
        if (!released) await finish(false).catch(() => undefined);
      }
    },
  };
}
