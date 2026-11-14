import { getSavedPaymentMethodById } from '@/lib/customer-saved-payment-methods';
import {
  type GoalChargeResult,
  processSavingsGoal,
  type SavingsAutoDebitProcessDependencies,
} from '@/lib/customer-savings-auto-debit-process';
import {
  getLagosParts,
  getSavingsAutoDebitPeriodKey,
} from '@/lib/customer-savings-auto-debit-schedule';
import type {
  DueSavingsGoalRow,
  SavingsAutoDebitDatabaseClient,
} from '@/lib/customer-savings-auto-debit-types';
import { creditWalletTopUp } from '@/lib/customer-wallet-top-up';
import { logger } from '@/lib/logger';
import { chargeAuthorization } from '@/lib/paystack';

const AUTO_DEBIT_CONCURRENCY_LIMIT = 5;
const AUTO_DEBIT_FETCH_MULTIPLIER = 4;

interface ChargeDueInput {
  batchSize?: number;
  chargeAuthorizationFn?: typeof chargeAuthorization;
  creditWalletTopUpFn?: typeof creditWalletTopUp;
  loadSavedPaymentMethodFn?: typeof getSavedPaymentMethodById;
  now?: Date;
  supabase: SavingsAutoDebitDatabaseClient;
}

export interface ChargeDueCustomerSavingsGoalsResult {
  /** Goals that threw unexpectedly (not ordinary declines): the cron fails. */
  errored: number;
  failed: number;
  processed: number;
  results: GoalChargeResult[];
  skipped: number;
}

function getLagosDate(now: Date) {
  return getLagosParts(now).date;
}

/**
 * Goals bound to a PiggyVest goal wallet are funded only through PiggyVest;
 * the database refuses a legacy contribution to them. They are excluded from
 * the due selection BEFORE any transaction or contribution row is created, so
 * they can not make a run fail and are not retried as due on every run.
 * Fails closed: a goal that can not be classified is never charged.
 */
async function findPrimaryBoundGoalIds(
  supabase: SavingsAutoDebitDatabaseClient,
  goals: readonly DueSavingsGoalRow[]
): Promise<Set<string>> {
  if (goals.length === 0) return new Set();
  const { data, error } = await supabase.rpc(
    'savings_goal_ids_bound_to_primary',
    { p_goal_ids: goals.map((goal) => goal.id) }
  );
  if (error || !Array.isArray(data)) {
    throw new Error(error?.message ?? 'Failed to classify savings goals');
  }
  if (data.some((id) => typeof id !== 'string')) {
    throw new Error('Failed to classify savings goals');
  }
  return new Set(data);
}

function failedGoalResult(goal: DueSavingsGoalRow, error: unknown) {
  return {
    goalId: goal.id,
    idempotencyKey: '',
    reference: '',
    reason: error instanceof Error ? error.message : 'unexpected_error',
    status: 'failed',
  } satisfies GoalChargeResult;
}

async function processSavingsGoalsWithConcurrency(
  dependencies: SavingsAutoDebitProcessDependencies,
  goals: DueSavingsGoalRow[]
) {
  const results = new Array<GoalChargeResult>(goals.length);
  let errored = 0;
  let nextIndex = 0;
  const workerCount = Math.min(AUTO_DEBIT_CONCURRENCY_LIMIT, goals.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= goals.length) {
        break;
      }
      const goal = goals[index];
      // One goal's failure is isolated: it is logged (the error log is the
      // page) and reported as failed, and the rest of the batch still runs.
      const [settled] = await Promise.allSettled([
        processSavingsGoal(dependencies, goal),
      ]);
      if (settled.status === 'fulfilled') {
        results[index] = settled.value;
        continue;
      }
      logger.error({
        message: 'Savings auto-debit failed for one goal',
        goalId: goal.id,
        error:
          settled.reason instanceof Error
            ? settled.reason.message
            : String(settled.reason),
      });
      errored += 1;
      results[index] = failedGoalResult(goal, settled.reason);
    }
  });

  await Promise.all(workers);
  return { errored, results };
}

export async function chargeDueCustomerSavingsGoals({
  batchSize = 50,
  chargeAuthorizationFn = chargeAuthorization,
  creditWalletTopUpFn = creditWalletTopUp,
  loadSavedPaymentMethodFn = getSavedPaymentMethodById,
  now = new Date(),
  supabase,
}: ChargeDueInput): Promise<ChargeDueCustomerSavingsGoalsResult> {
  const fetchLimit = Math.max(
    batchSize * AUTO_DEBIT_FETCH_MULTIPLIER,
    batchSize
  );
  const dueGoals: DueSavingsGoalRow[] = [];
  const skippedResults: GoalChargeResult[] = [];
  let pageStart = 0;

  while (dueGoals.length < batchSize) {
    const { data, error } = await supabase
      .from('customer_savings_goals')
      .select(
        'id, merchant_id, customer_id, target_amount, current_amount, contribution_amount, contribution_frequency, preferred_debit_time, start_date, maturity_date, saved_payment_method_id'
      )
      .eq('status', 'active')
      .eq('source_mode', 'auto_debit')
      .lte('start_date', getLagosDate(now))
      .order('id', { ascending: true })
      .range(pageStart, pageStart + fetchLimit - 1);

    if (error) {
      throw new Error(error.message ?? 'Failed to fetch due savings goals');
    }

    const goals = (data ?? []) as DueSavingsGoalRow[];
    const primaryBound = await findPrimaryBoundGoalIds(supabase, goals);
    for (const goal of goals) {
      if (primaryBound.has(goal.id)) {
        skippedResults.push({
          goalId: goal.id,
          idempotencyKey: '',
          reference: '',
          reason: 'primary_wallet_goal',
          status: 'skipped',
        });
        continue;
      }
      const periodKey = getSavingsAutoDebitPeriodKey(goal, now);
      if (periodKey && dueGoals.length < batchSize) {
        dueGoals.push(goal);
        continue;
      }

      skippedResults.push({
        goalId: goal.id,
        idempotencyKey: '',
        reference: '',
        reason: periodKey ? 'batch_limit' : 'not_due',
        status: 'skipped',
      });
    }

    if (goals.length < fetchLimit) {
      break;
    }

    pageStart += fetchLimit;
  }

  const charged = await processSavingsGoalsWithConcurrency(
    {
      chargeAuthorizationFn,
      creditWalletTopUpFn,
      loadSavedPaymentMethodFn,
      now,
      supabase,
    },
    dueGoals
  );
  const results = [...charged.results, ...skippedResults];

  return {
    errored: charged.errored,
    failed: results.filter((result) => result.status === 'failed').length,
    processed: results.filter((result) => result.status === 'charged').length,
    results,
    skipped: results.filter((result) => result.status === 'skipped').length,
  };
}
