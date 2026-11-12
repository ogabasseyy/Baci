import 'server-only';
import { piggyvestDailyReconciliationSchemas as schemas } from '@/schemas/piggyvest-daily-reconciliation';
import {
  DEGRADED_STALE_AFTER_SECONDS,
  type DegradedAlert,
  decideDegradedAlerts,
} from './degraded-health-decision';
import { isPiggyvestFeatureFlagSet } from './piggyvest-feature-on';
import { createPrimaryWalletEvidenceExecutor } from './primary-wallet-evidence-executor';
import { readPrimaryWalletSavingsRecoveryRuntime } from './primary-wallet-savings-runtime';
import { emitPiggyvestWebhookAlert } from './webhook-alerts';

/**
 * Read-only degraded-health check. Off until PIGGYVEST_DEGRADED_ALERTS_ENABLED
 * is exactly "true". Reads only an aggregate count through the restricted
 * evidence login (the same read-only function the daily reconciliation uses),
 * never service role, and pages with counts only. Like the reconciliation it
 * ignores the master kill switch: a rollback must not hide a stuck transfer.
 *
 * Rate limit: one page per reason per UTC hour. The hour bucket is both the
 * in-process claim below and the PostHog operation id, so a 5-minute schedule
 * pages at most once an hour per reason from a warm instance.
 */
const SNAPSHOT_STATEMENT =
  'SELECT piggyvest_primary.read_daily_reconciliation($1::uuid,$2::text,$3::jsonb) AS result';
const MS_PER_HOUR = 3_600_000;
const CLAIM_CAPACITY = 64;

const claimedPages = new Set<string>();

export interface DegradedHealthDeps {
  readRuntime: typeof readPrimaryWalletSavingsRecoveryRuntime;
  createExecutor: typeof createPrimaryWalletEvidenceExecutor;
  emitAlert: typeof emitPiggyvestWebhookAlert;
  nowMs: () => number;
}

function defaultDeps(): DegradedHealthDeps {
  return {
    readRuntime: readPrimaryWalletSavingsRecoveryRuntime,
    createExecutor: createPrimaryWalletEvidenceExecutor,
    emitAlert: emitPiggyvestWebhookAlert,
    nowMs: () => Date.now(),
  };
}

export type DegradedHealthResult =
  | { status: 'disabled' }
  | {
      status: 'checked';
      indeterminateTransfers: number | null;
      /** The transfers read failed: reported, never mistaken for healthy. */
      readFailed: boolean;
      alerts: number;
      paged: number;
    };

async function readIndeterminateTransfers(
  deps: DegradedHealthDeps,
  env: NodeJS.ProcessEnv
): Promise<number | null | 'failed'> {
  try {
    const runtime = deps.readRuntime(env);
    // Switched on but not configured: as unknown as a failed read.
    if (!runtime) return 'failed';
    const execute = deps.createExecutor(runtime.reconciliationConfiguration);
    const { environment, integrationId } = runtime.configuration;
    const { rows } = await execute(SNAPSHOT_STATEMENT, [
      integrationId,
      environment,
      JSON.stringify({ staleAfterSeconds: DEGRADED_STALE_AFTER_SECONDS }),
    ]);
    const parsed = schemas.snapshotRows.safeParse(rows);
    return parsed.success ? parsed.data[0].result.stuckTotal : 'failed';
  } catch {
    return 'failed';
  }
}

function claimPage(reason: string, hour: number): boolean {
  const key = `${reason}:${hour}`;
  if (claimedPages.has(key)) return false;
  claimedPages.add(key);
  if (claimedPages.size > CLAIM_CAPACITY) {
    const oldest = claimedPages.values().next().value;
    if (oldest !== undefined) claimedPages.delete(oldest);
  }
  return true;
}

export async function runPiggyvestDegradedHealth(
  options: { env?: NodeJS.ProcessEnv; deps?: Partial<DegradedHealthDeps> } = {}
): Promise<DegradedHealthResult> {
  const env = options.env ?? process.env;
  if (!isPiggyvestFeatureFlagSet('degraded_alerts', env))
    return { status: 'disabled' };
  const deps = { ...defaultDeps(), ...options.deps };
  const transfersRead = await readIndeterminateTransfers(deps, env);
  const readFailed = transfersRead === 'failed';
  const indeterminateTransfers = readFailed ? null : transfersRead;
  const alerts: DegradedAlert[] = decideDegradedAlerts({
    indeterminateTransfers,
  });
  const hour = Math.floor(deps.nowMs() / MS_PER_HOUR);
  let paged = 0;
  for (const alert of alerts) {
    if (!claimPage(alert.reason, hour)) continue;
    paged += 1;
    deps.emitAlert('PIGGYVEST_DEGRADED', {
      reason: alert.reason,
      attempts: alert.attempts,
      operationId: `degraded-${alert.reason}-${hour}`,
    });
  }
  // A check that cannot read must not look healthy: page that too (same
  // hourly throttle), so an outage of the read itself is seen.
  if (readFailed && claimPage('health_read_failed', hour)) {
    paged += 1;
    deps.emitAlert('PIGGYVEST_DEGRADED', {
      reason: 'health_read_failed',
      operationId: `degraded-health_read_failed-${hour}`,
    });
  }
  return {
    status: 'checked',
    indeterminateTransfers,
    readFailed,
    alerts: alerts.length,
    paged,
  };
}

/** Test-only: forget which pages were already sent. */
export function resetDegradedHealthClaims(): void {
  claimedPages.clear();
}
