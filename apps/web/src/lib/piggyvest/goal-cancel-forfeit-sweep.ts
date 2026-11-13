import 'server-only';
import { piggyvestGoalCancelForfeitSchemas as schemas } from '@/schemas/piggyvest-goal-cancel-forfeit';
import { piggyvestPrimaryInflowRuntimeSchema } from '@/schemas/piggyvest-primary-inflow-runtime';
import { piggyvestPrimarySavingsRuntimeSchema } from '@/schemas/piggyvest-primary-savings-runtime';
import { piggyvestPrimaryWalletRuntimeSchema } from '@/schemas/piggyvest-primary-wallet-runtime';
import { pageGoalCancelAlerts } from './goal-cancel-alert-pages';
import { driveGoalCancelForfeit } from './goal-cancel-forfeit';
import { forfeitDriverPorts } from './goal-cancel-forfeit-ports';
import { GOAL_CANCEL_FORFEIT_STATEMENTS as sql } from './goal-cancel-forfeit-statements';
import {
  readGoalInterestWalletId,
  readGoalInterestWalletOwnerId,
} from './goal-interest-wallet-env';
import { getPrimaryWalletProviderOrigin } from './primary-wallet-provider-origin';
import { createPrimaryWalletSavingsExecutor } from './primary-wallet-savings-executor';
import { emitPiggyvestWebhookAlert } from './webhook-alerts';

export const GOAL_CANCEL_FORFEIT_SWEEP_LIMIT = 50;

export interface GoalCancelForfeitSweepResult {
  listed: number;
  confirmed: number;
  pending: number;
  // Stuck or rejected (needs_review, unavailable, released): a person
  // should look, unlike ordinary pending work.
  attention: number;
  skipped: number;
  failed: number;
  // Listed but not started because the deadline passed; next run picks them up.
  deferred: number;
}

/**
 * The scheduled sweep of early-cancel interest forfeits (run by its own daily
 * cron route). It sends forfeits nobody's status check picked up
 * (for example a cancel confirmed by the outflow webhook after the customer
 * left) and settles in-flight ones from a verified PiggyVest record. New
 * transfers go only while PiggyVest savings are switched on
 * (allowNewTransfers); a rollback still lets in-flight ones settle. An
 * overdue in-flight forfeit pages until the page is acknowledged (after it
 * was emitted). Never throws per forfeit.
 */
export async function sweepPendingGoalCancelForfeits(input: {
  configuration: unknown;
  reconciliationConfiguration: unknown;
  providerToken: unknown;
  allowNewTransfers: boolean;
  limit?: number;
  // No new forfeit is started at or after this time (ms since epoch), so the
  // caller keeps its own time budget. One started forfeit can still take
  // its provider timeouts to finish.
  deadlineAt?: number;
  now?: () => number;
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
      await execute(sql.workerList, [
        ...bound(String(input.limit ?? GOAL_CANCEL_FORFEIT_SWEEP_LIMIT)),
        // While new transfers are off only in-flight forfeits are listed, so
        // unsent ones can not crowd out settling those already sent.
        String(input.allowNewTransfers),
      ])
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
    attention: 0,
    skipped: 0,
    failed: 0,
    deferred: 0,
  };
  const now = input.now ?? Date.now;
  // Alerts are paged (then acknowledged) before any transfer is driven, all
  // within the deadline; one left over is paged again next run.
  const forfeitPages = await pageGoalCancelAlerts({
    items: work.filter((item) => item.alert),
    emit: (item) =>
      emitPiggyvestWebhookAlert('PIGGYVEST_GOAL_CANCEL_FORFEIT_NEEDS_REVIEW', {
        // A plan that went to review with nobody paged, or a sent forfeit
        // still in flight a day on.
        reason:
          item.state === 'needs_review'
            ? 'forfeit_needs_review'
            : 'forfeit_overdue',
        operationId: item.operationId,
      }),
    acknowledge: async (item) =>
      schemas.ackRows.parse(
        (await execute(sql.workerAck, bound(item.forfeitId))).rows
      ),
    deadlineAt: input.deadlineAt,
    now,
  });
  result.failed += forfeitPages.failed;
  // Cancels held before anything was sent (an operator must act): paged
  // until acknowledged a day apart, so a hold is never silent even when the
  // submit path's own page was lost.
  const holds = schemas.holdRows.parse(
    (
      await execute(sql.workerHolds, [
        configuration.integrationId,
        configuration.environment,
      ])
    ).rows
  )[0].result;
  const holdPages = await pageGoalCancelAlerts({
    items: holds,
    emit: (hold) =>
      emitPiggyvestWebhookAlert('PIGGYVEST_GOAL_CANCEL_NEEDS_REVIEW', {
        reason: hold.reason,
        operationId: hold.operationId,
      }),
    acknowledge: async (hold) =>
      schemas.ackRows.parse(
        (await execute(sql.workerHoldAck, bound(hold.operationId))).rows
      ),
    deadlineAt: input.deadlineAt,
    now,
  });
  result.attention += holdPages.paged;
  result.failed += holdPages.failed;
  for (const [index, item] of work.entries()) {
    if (input.deadlineAt !== undefined && now() >= input.deadlineAt) {
      result.deferred = work.length - index;
      break;
    }
    if (item.state === 'needs_review') {
      // Listed only to page it: a person resolves it, nothing is driven.
      result.attention += 1;
      continue;
    }
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
          unclaim: async (id) =>
            schemas.unclaimRows.parse(
              (await execute(sql.workerUnclaim, bound(id))).rows
            )[0].result,
          markPosting: async (id, token) =>
            schemas.postingRows.parse(
              (await execute(sql.workerPosting, [...bound(id), token])).rows
            )[0].result,
          ackAlert: async (id) =>
            schemas.ackRows.parse(
              (await execute(sql.workerAck, bound(id))).rows
            )[0].result,
          provider,
          evidence,
          operationId: item.operationId,
          expectedDestinationWalletId: readGoalInterestWalletId(),
          expectedDestinationOwnerId: readGoalInterestWalletOwnerId(),
        })
      );
      if (outcome === 'confirmed') result.confirmed += 1;
      else if (
        outcome === 'needs_review' ||
        outcome === 'unavailable' ||
        outcome === 'released'
      )
        result.attention += 1;
      else result.pending += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
