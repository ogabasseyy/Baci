import {
  GOAL_RECHECK_DELAY_MS,
  GOAL_ROUTING_VARIANTS,
  type GoalRoutingReading,
  type GoalRoutingVariant,
  type RoutingIds,
  readGoalRouting,
} from './goal-interest-routing';
import { p7RoutingGoalName } from './goal-wallet-names';
import {
  type GoalOwner,
  type GoalVariantResult,
  runGoalVariant,
} from './proof-7-goal-variants';
import type { ProofContext } from './proof-context';
import { recordOf } from './read-rules';

/**
 * Proof 7, goal routing: creates the four goal variants (opted in or out,
 * payout unset, main or business) under one owner, reads each back at once,
 * waits GOAL_RECHECK_DELAY_MS and reads every created goal once more. Each
 * variant is its own journaled slot: a re-run finds it by its deterministic
 * name and never resends it.
 */

export interface GoalRoutingRun {
  variant: GoalRoutingVariant;
  /** Never emitted: registered with the redactor. */
  walletName: string;
  /** null when the variant was not sent (no wallet to name as its payout). */
  result: GoalVariantResult | null;
  atOnce: GoalRoutingReading;
  afterRecheck: GoalRoutingReading;
}

const UNREAD: GoalRoutingReading = { interestEnabled: null, payout: 'unread' };

function idsFor(
  walletId: string,
  owner: GoalOwner,
  business: string
): RoutingIds {
  return { self: walletId, main: owner.mainWalletId ?? null, business };
}

function payoutTarget(
  variant: GoalRoutingVariant,
  owner: GoalOwner,
  business: string
): string | null {
  if (variant.payout === 'business') return business;
  if (variant.payout === 'main') return owner.mainWalletId ?? null;
  return null;
}

export async function runGoalRouting(
  ctx: ProofContext,
  owner: GoalOwner,
  business: string
): Promise<GoalRoutingRun[]> {
  const runs: GoalRoutingRun[] = [];
  for (const variant of GOAL_ROUTING_VARIANTS) {
    const walletName = p7RoutingGoalName(
      owner.qa.qaKey,
      variant.id,
      ctx.attempt
    );
    ctx.redactor.register('Q', walletName);
    // The form the sandbox lists it under.
    ctx.redactor.register('Q', walletName.replaceAll('-', ''));
    const payoutWalletId = payoutTarget(variant, owner, business);
    if (variant.payout !== 'unset' && payoutWalletId === null) {
      runs.push({
        variant,
        walletName,
        result: null,
        atOnce: UNREAD,
        afterRecheck: UNREAD,
      });
      continue;
    }
    const result = await runGoalVariant(ctx, owner, business, {
      slot: variant.slot,
      walletName,
      payoutWalletId,
      enableInterestAccrual: variant.accrual,
    });
    runs.push({
      variant,
      walletName,
      result,
      atOnce: result.walletId
        ? readGoalRouting(
            result.readbackRecord,
            idsFor(result.walletId, owner, business)
          )
        : UNREAD,
      afterRecheck: UNREAD,
    });
  }
  const created = runs.filter((run) => run.result?.walletId);
  if (created.length === 0) return runs;
  await ctx.sleep(GOAL_RECHECK_DELAY_MS);
  for (const run of created) {
    const walletId = run.result?.walletId;
    if (!walletId) continue;
    const call = await ctx.api.wallet(walletId);
    run.afterRecheck = readGoalRouting(
      recordOf(call),
      idsFor(walletId, owner, business)
    );
  }
  return runs;
}
