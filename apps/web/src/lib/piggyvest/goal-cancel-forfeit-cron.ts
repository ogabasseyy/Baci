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
 * credentials are not configured; a sweep that fails answers
 * { status: 'failed' } (and logs the reason). Never throws, so it can not fail
 * the reconciliation report it runs beside. Counts only, never transfer
 * detail.
 */
export async function runScheduledGoalCancelForfeitSweep(
  env: NodeJS.ProcessEnv = process.env,
  sweep: typeof sweepPendingGoalCancelForfeits = sweepPendingGoalCancelForfeits,
  deadlineAt?: number
): Promise<GoalCancelForfeitSweepResult | { status: 'failed' } | null> {
  let runtime: ReturnType<typeof readPrimaryWalletSavingsRecoveryRuntime>;
  try {
    runtime = readPrimaryWalletSavingsRecoveryRuntime(env);
  } catch {
    // Not configured here: the sweep is inert, not failing.
    return null;
  }
  try {
    return await sweep({
      configuration: runtime.configuration,
      reconciliationConfiguration: runtime.reconciliationConfiguration,
      providerToken: runtime.providerToken,
      allowNewTransfers: goalCancelForfeitTransfersAllowed(env),
      ...(deadlineAt === undefined ? {} : { deadlineAt }),
    });
  } catch (error) {
    // A sweep outage is reported, never mistaken for "nothing to do".
    console.warn(
      '[PiggyVest] Goal cancel forfeit sweep failed:',
      error instanceof Error ? error.message : 'unknown error'
    );
    return { status: 'failed' };
  }
}
