import 'server-only';
import { piggyvestGoalCancelSchemas as schemas } from '@/schemas/piggyvest-goal-cancel';
import { piggyvestPrimaryInflowRuntimeSchema } from '@/schemas/piggyvest-primary-inflow-runtime';
import { piggyvestPrimaryWalletRuntimeSchema } from '@/schemas/piggyvest-primary-wallet-runtime';
import { GOAL_CANCEL_STATEMENTS as sql } from './goal-cancel-statements';
import { createPrimaryWalletEvidenceExecutor } from './primary-wallet-evidence-executor';
import { reconcilePrimaryWalletSavings } from './primary-wallet-savings-reconciliation';
import { createSavingsVerifyQueryProvider } from './primary-wallet-savings-reconciliation-runtime';

type Execute = (
  statement: string,
  parameters: readonly string[]
) => Promise<{ rows: unknown }>;

/**
 * The evidence-login side of a goal cancel: read the dispatched attempt, then
 * settle or release it from a verified provider record. It carries no
 * dispatch handle, so it can only conclude what the provider already did.
 */
export function createGoalCancelEvidenceStore(input: {
  integrationId: string;
  environment: 'staging' | 'production';
  execute: Execute;
}) {
  async function run(statement: string, selection: string) {
    const result = await input.execute(statement, [
      input.integrationId,
      input.environment,
      selection,
    ]);
    if (!Array.isArray(result.rows) || result.rows.length !== 1)
      throw new Error('Goal cancel settlement unavailable');
    const row: unknown = result.rows[0];
    if (row === null || typeof row !== 'object' || !('result' in row))
      throw new Error('Goal cancel settlement unavailable');
    return row.result;
  }
  return {
    async loadDispatched(operationId: string) {
      const result = await run(
        sql.readDispatched,
        schemas.operationId.parse(operationId)
      );
      return result === null
        ? null
        : schemas.dispatchedReservation.parse(result);
    },
    async settle(
      proof: object
    ): Promise<'confirmed' | 'duplicate' | 'conflict'> {
      const { status: _status, ...receipt } = proof as Record<string, unknown>;
      const result = await run(sql.settle, JSON.stringify(receipt));
      if (
        result !== 'confirmed' &&
        result !== 'duplicate' &&
        result !== 'conflict'
      )
        throw new Error('Goal cancel settlement unavailable');
      return result;
    },
    async release(
      proof: object
    ): Promise<'released' | 'duplicate' | 'conflict'> {
      const { status: _status, ...receipt } = proof as Record<string, unknown>;
      const result = await run(sql.release, JSON.stringify(receipt));
      if (
        result !== 'released' &&
        result !== 'duplicate' &&
        result !== 'conflict'
      )
        throw new Error('Goal cancel settlement unavailable');
      return result;
    },
  };
}

/**
 * Re-queries the provider for the dispatched cancel and settles it (success)
 * or releases it (provider-reported failure). Anything else, including a 404
 * right after the submit, stays pending: nothing is resent or released.
 */
export async function runGoalCancelReconciliation(input: {
  configuration: unknown;
  providerToken: unknown;
  operationId: unknown;
  fetchImplementation?: typeof fetch;
}) {
  const configuration = piggyvestPrimaryInflowRuntimeSchema.parse(
    input.configuration
  );
  const token = piggyvestPrimaryWalletRuntimeSchema.shape.providerToken.parse(
    input.providerToken
  );
  const store = createGoalCancelEvidenceStore({
    integrationId: configuration.integrationId,
    environment: configuration.environment,
    execute: createPrimaryWalletEvidenceExecutor(configuration),
  });
  return await reconcilePrimaryWalletSavings(input.operationId, {
    ...store,
    queryProvider: createSavingsVerifyQueryProvider({
      environment: configuration.environment,
      token,
      fetchImplementation: input.fetchImplementation,
    }),
  });
}
