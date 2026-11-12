import 'server-only';
import {
  type GoalCancelForfeitSweepResult,
  sweepPendingGoalCancelForfeits,
} from './goal-cancel-forfeit-sweep';
import {
  readPrimaryWalletSavingsRecoveryRuntime,
  readPrimaryWalletSavingsRuntime,
} from './primary-wallet-savings-runtime';

/** True only while PiggyVest savings are switched on (flags and kill switch). */
export function goalCancelForfeitTransfersAllowed(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  try {
    return readPrimaryWalletSavingsRuntime(env) !== null;
  } catch {
    return false;
  }
}

/**
 * The daily cron's forfeit sweep. Inert (null) wherever the PiggyVest savings
 * credentials are not configured; never throws, so it can not fail the
 * reconciliation report it runs beside. Counts only, never transfer detail.
 */
export async function runScheduledGoalCancelForfeitSweep(
  env: NodeJS.ProcessEnv = process.env,
  sweep: typeof sweepPendingGoalCancelForfeits = sweepPendingGoalCancelForfeits,
  deadlineAt?: number
): Promise<GoalCancelForfeitSweepResult | null> {
  try {
    const runtime = readPrimaryWalletSavingsRecoveryRuntime(env);
    return await sweep({
      configuration: runtime.configuration,
      reconciliationConfiguration: runtime.reconciliationConfiguration,
      providerToken: runtime.providerToken,
      allowNewTransfers: goalCancelForfeitTransfersAllowed(env),
      ...(deadlineAt === undefined ? {} : { deadlineAt }),
    });
  } catch {
    return null;
  }
}
