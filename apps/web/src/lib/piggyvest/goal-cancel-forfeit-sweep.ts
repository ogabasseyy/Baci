import 'server-only';
import { piggyvestGoalCancelForfeitSchemas as schemas } from '@/schemas/piggyvest-goal-cancel-forfeit';
import { piggyvestPrimaryInflowRuntimeSchema } from '@/schemas/piggyvest-primary-inflow-runtime';
import { piggyvestPrimarySavingsRuntimeSchema } from '@/schemas/piggyvest-primary-savings-runtime';
import { piggyvestPrimaryWalletRuntimeSchema } from '@/schemas/piggyvest-primary-wallet-runtime';
import { driveGoalCancelForfeit } from './goal-cancel-forfeit';
import { forfeitDriverPorts } from './goal-cancel-forfeit-ports';
import { GOAL_CANCEL_FORFEIT_STATEMENTS as sql } from './goal-cancel-forfeit-statements';
import { getPrimaryWalletProviderOrigin } from './primary-wallet-provider-origin';
import { createPrimaryWalletSavingsExecutor } from './primary-wallet-savings-executor';
import { emitPiggyvestWebhookAlert } from './webhook-alerts';

export const GOAL_CANCEL_FORFEIT_SWEEP_LIMIT = 50;

export interface GoalCancelForfeitSweepResult {
  listed: number;
  confirmed: number;
  pending: number;
  skipped: number;
  failed: number;
}

/**
 * The scheduled sweep of early-cancel interest forfeits (run by the daily
 * reconciliation cron). It sends forfeits nobody's status check picked up
 * (for example a cancel confirmed by the outflow webhook after the customer
 * left) and settles in-flight ones from a verified PiggyVest record. New
 * transfers go only while PiggyVest savings are switched on
 * (allowNewTransfers); a rollback still lets in-flight ones settle. An
 * overdue in-flight forfeit pages once. Never throws per forfeit.
 */
export async function sweepPendingGoalCancelForfeits(input: {
  configuration: unknown;
  reconciliationConfiguration: unknown;
  providerToken: unknown;
  allowNewTransfers: boolean;
  limit?: number;
}): Promise<GoalCancelForfeitSweepResult> {
  const configuration = piggyvestPrimarySavingsRuntimeSchema.parse(
    input.configuration
  );
  const evidence = piggyvestPrimaryInflowRuntimeSchema.parse(
    input.reconciliationConfiguration
  );
  if (
    evidence.integrationId !== configuration.integrationId ||
    evidence.environment !== configuration.environment
  )
    throw new Error('Goal cancel forfeit sweep binding unavailable');
  const token = piggyvestPrimaryWalletRuntimeSchema.shape.providerToken.parse(
    input.providerToken
  );
  const execute = createPrimaryWalletSavingsExecutor(configuration);
  const bound = (selection: string) => [
    configuration.integrationId,
    configuration.environment,
    selection,
  ];
  const work = schemas.workRows.parse(
    (
      await execute(
        sql.workerList,
        bound(String(input.limit ?? GOAL_CANCEL_FORFEIT_SWEEP_LIMIT))
      )
    ).rows
  )[0].result;
  const provider = {
    token,
    baseUrl: getPrimaryWalletProviderOrigin(configuration.environment),
  };
  const result: GoalCancelForfeitSweepResult = {
    listed: work.length,
    confirmed: 0,
    pending: 0,
    skipped: 0,
    failed: 0,
  };
  for (const item of work) {
    if (item.alert)
      emitPiggyvestWebhookAlert('PIGGYVEST_GOAL_CANCEL_FORFEIT_NEEDS_REVIEW', {
        reason: 'forfeit_overdue',
        operationId: item.operationId,
      });
    if (item.state === 'reserved' && !input.allowNewTransfers) {
      result.skipped += 1;
      continue;
    }
    try {
      const outcome = await driveGoalCancelForfeit(
        item.operationId,
        forfeitDriverPorts({
          claim: async (id) =>
            schemas.claimRows.parse(
              (await execute(sql.workerClaim, bound(id))).rows
            )[0].result,
          release: async (id) =>
            schemas.releaseRows.parse(
              (await execute(sql.workerRelease, bound(id))).rows
            )[0].result,
          provider,
          evidence,
          operationId: item.operationId,
        })
      );
      if (outcome === 'confirmed') result.confirmed += 1;
      else result.pending += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
