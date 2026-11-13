import 'server-only';
import { piggyvestDailyReconciliationSchemas as schemas } from '@/schemas/piggyvest-daily-reconciliation';
import { piggyvestGoalWalletSetupHealthSchemas as goalSchemas } from '@/schemas/piggyvest-goal-wallet-setup-health';
import {
  DEGRADED_STALE_AFTER_SECONDS,
  type DegradedAlert,
  decideDegradedAlerts,
} from './degraded-health-decision';
import {
  claimDegradedPage,
  claimSharedPage,
  resetDegradedPageClaims,
  type SharedPageClaim,
} from './degraded-health-page-claim';
import { isPiggyvestFeatureFlagSet } from './piggyvest-feature-on';
import { createPrimaryWalletEvidenceExecutor } from './primary-wallet-evidence-executor';
import { readPrimaryWalletSavingsRecoveryRuntime } from './primary-wallet-savings-runtime';
import { emitPiggyvestWebhookAlert } from './webhook-alerts';

/**
 * Read-only degraded-health check. Off until PIGGYVEST_DEGRADED_ALERTS_ENABLED
 * is exactly "true". Reads only an aggregate count through the restricted
 * evidence login (the same read-only login the daily reconciliation uses: stuck transfers from
 * read_daily_reconciliation, stalled goal-wallet setups from
 * read_goal_wallet_setup_health),
 * never service role, and pages with counts only. Like the reconciliation it
 * ignores the master kill switch: a rollback must not hide a stuck transfer.
 *
 * Rate limit: one page per reason per UTC hour. The hour bucket is both the
 * page claim and the PostHog operation id, so a 5-minute schedule pages at
 * most once an hour per reason. Buckets centre on the top of the hour (the
 * nearest hour), matching the claim's Redis-less window: a run a minute
 * early (10:59) belongs to the coming hour (11), not the one ending.
 */
const SNAPSHOT_STATEMENT =
  'SELECT piggyvest_primary.read_daily_reconciliation($1::uuid,$2::text,$3::jsonb) AS result';
const GOAL_WALLET_STATEMENT =
  'SELECT piggyvest_primary.read_goal_wallet_setup_health($1::uuid,$2::text,$3::jsonb) AS result';
const MS_PER_HOUR = 3_600_000;

export interface DegradedHealthDeps {
  readRuntime: typeof readPrimaryWalletSavingsRecoveryRuntime;
  createExecutor: typeof createPrimaryWalletEvidenceExecutor;
  emitAlert: typeof emitPiggyvestWebhookAlert;
  nowMs: () => number;
  /** Shared (cross-instance) page claim; null answers fall back locally. */
  claimShared: SharedPageClaim;
}

function defaultDeps(): DegradedHealthDeps {
  return {
    readRuntime: readPrimaryWalletSavingsRecoveryRuntime,
    createExecutor: createPrimaryWalletEvidenceExecutor,
    emitAlert: emitPiggyvestWebhookAlert,
    nowMs: () => Date.now(),
    claimShared: claimSharedPage,
  };
}

export type DegradedHealthResult =
  | { status: 'disabled' }
  | {
      status: 'checked';
      indeterminateTransfers: number | null;
      stalledGoalWallets: number | null;
      /** A read failed: reported, never mistaken for healthy. */
      readFailed: boolean;
      alerts: number;
      paged: number;
    };

type CountRead = number | null | 'failed';

/** Runs one allowlisted aggregate read through the evidence executor. */
async function readCount(
  deps: DegradedHealthDeps,
  env: NodeJS.ProcessEnv,
  statement: string,
  parse: (rows: unknown) => number | null
): Promise<CountRead> {
  try {
    const runtime = deps.readRuntime(env);
    // Switched on but not configured: as unknown as a failed read.
    if (!runtime) return 'failed';
    const execute = deps.createExecutor(runtime.reconciliationConfiguration);
    const { environment, integrationId } = runtime.configuration;
    const { rows } = await execute(statement, [
      integrationId,
      environment,
      JSON.stringify({ staleAfterSeconds: DEGRADED_STALE_AFTER_SECONDS }),
    ]);
    return parse(rows) ?? 'failed';
  } catch {
    return 'failed';
  }
}

function readIndeterminateTransfers(
  deps: DegradedHealthDeps,
  env: NodeJS.ProcessEnv
): Promise<CountRead> {
  return readCount(deps, env, SNAPSHOT_STATEMENT, (rows) => {
    const parsed = schemas.snapshotRows.safeParse(rows);
    return parsed.success ? parsed.data[0].result.stuckTotal : null;
  });
}

function readStalledGoalWallets(
  deps: DegradedHealthDeps,
  env: NodeJS.ProcessEnv
): Promise<CountRead> {
  return readCount(deps, env, GOAL_WALLET_STATEMENT, (rows) => {
    const parsed = goalSchemas.rows.safeParse(rows);
    return parsed.success ? parsed.data[0].result.stalledGoalWallets : null;
  });
}

export async function runPiggyvestDegradedHealth(
  options: { env?: NodeJS.ProcessEnv; deps?: Partial<DegradedHealthDeps> } = {}
): Promise<DegradedHealthResult> {
  const env = options.env ?? process.env;
  if (!isPiggyvestFeatureFlagSet('degraded_alerts', env))
    return { status: 'disabled' };
  const deps = { ...defaultDeps(), ...options.deps };
  const [transfersRead, goalWalletsRead] = await Promise.all([
    readIndeterminateTransfers(deps, env),
    readStalledGoalWallets(deps, env),
  ]);
  const readFailed = transfersRead === 'failed' || goalWalletsRead === 'failed';
  const indeterminateTransfers =
    transfersRead === 'failed' ? null : transfersRead;
  const stalledGoalWallets =
    goalWalletsRead === 'failed' ? null : goalWalletsRead;
  const alerts: DegradedAlert[] = decideDegradedAlerts({
    indeterminateTransfers,
    stalledGoalWallets,
  });
  const now = deps.nowMs();
  const hour = Math.round(now / MS_PER_HOUR);
  let paged = 0;
  for (const alert of alerts) {
    if (!(await claimDegradedPage(alert.reason, hour, deps.claimShared, now)))
      continue;
    paged += 1;
    deps.emitAlert('PIGGYVEST_DEGRADED', {
      reason: alert.reason,
      attempts: alert.attempts,
      operationId: `degraded-${alert.reason}-${hour}`,
    });
  }
  // A check that cannot read must not look healthy: page that too (same
  // hourly throttle), so an outage of the read itself is seen.
  if (
    readFailed &&
    (await claimDegradedPage('health_read_failed', hour, deps.claimShared, now))
  ) {
    paged += 1;
    deps.emitAlert('PIGGYVEST_DEGRADED', {
      reason: 'health_read_failed',
      operationId: `degraded-health_read_failed-${hour}`,
    });
  }
  return {
    status: 'checked',
    indeterminateTransfers,
    stalledGoalWallets,
    readFailed,
    alerts: alerts.length,
    paged,
  };
}

/** Test-only: forget which pages were already sent in this copy. */
export function resetDegradedHealthClaims(): void {
  resetDegradedPageClaims();
}
