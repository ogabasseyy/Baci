import 'server-only';
import {
  PIGGYVEST_CAPTURE_DRAIN_LOGIN,
  type PiggyvestCaptureDrainRuntime,
  piggyvestCaptureDrainRuntimeSchema,
} from '@/schemas/piggyvest/webhook-capture-drain-runtime';
import {
  authorizesLegacyHandling,
  primaryOwnerFamily,
} from './primary-event-owner';
import {
  isPiggyvestCaptureDrainEnabled,
  isPiggyvestCaptureLegacyReplayEnabled,
} from './webhook-capture-attestation';
import type { DrainDeps, DrainSummary } from './webhook-capture-drain';
import { runCaptureDrainPass } from './webhook-capture-drain-pass';
import { workerHostReplayScope } from './webhook-capture-drain-scope';
import { verifyOnWorkerHost } from './webhook-capture-host-verify';
import {
  type CaptureDrainExecutor,
  createCaptureDrainPgExecutor,
} from './webhook-capture-pg-executor';
import {
  collectPrimaryIntakeEvidence,
  type PrimaryIntakeEvidence,
  type PrimaryIntakeFamily,
} from './webhook-capture-primary-intake-readiness';
import { replayPrimaryDelivery } from './webhook-capture-primary-replay';
import { createPgCaptureQueue } from './webhook-capture-queue';
import { monitorCaptureReviews } from './webhook-capture-review-monitor';
import { isPiggyvestWebhookIntakeRuntimeReady } from './webhook-intake-runtime';

/**
 * The worker-host capture drain (R5): one bounded pass over the captured
 * PiggyVest deliveries, run every minute by cron.
 *
 * Dark by default. Unless PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_ENABLED is
 * exactly 'true' on the host it reads no configuration and opens no
 * connection. When enabled it connects only as the dedicated drain login
 * (never a service-role key), re-verifies every stored signature (a row
 * signed by a key this host does not hold is deferred, never parked),
 * replays primary rows through their own logins, and optionally replays
 * legacy rows through the restricted webhook-intake login. Replay is
 * idempotent because every downstream ledger keys on the provider
 * transaction id, so a crash at any point is recovered by the next pass
 * once the lease expires.
 */

export { isPiggyvestCaptureDrainEnabled };

/** Rows per pass: small enough to finish well inside the cron timeout. */
export const CAPTURE_DRAIN_BATCH = 10;

/**
 * The drain login's connection settings. The database host, name and CA
 * are the ones every PiggyVest primary login shares; only the password is
 * the drain's own. The login name is fixed in code.
 */
export function readPiggyvestCaptureDrainRuntime(
  env: NodeJS.ProcessEnv
): PiggyvestCaptureDrainRuntime | null {
  const parsed = piggyvestCaptureDrainRuntimeSchema.safeParse({
    database: {
      host: env.PIGGYVEST_PRIMARY_DB_HOST,
      port: Number(env.PIGGYVEST_PRIMARY_DB_PORT),
      name: env.PIGGYVEST_PRIMARY_DB_NAME,
      login: PIGGYVEST_CAPTURE_DRAIN_LOGIN,
      password: env.PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_DB_PASSWORD,
      certificateAuthority: env.PIGGYVEST_PRIMARY_DB_CA,
    },
  });
  return parsed.success ? parsed.data : null;
}

export type CaptureDrainRun =
  | { status: 'disabled' }
  | { status: 'unconfigured' }
  | { status: 'intake_not_ready'; notReady: PrimaryIntakeFamily[] }
  | { status: 'legacy_intake_not_ready' }
  | { status: 'drained'; summary: DrainSummary };

export interface CaptureDrainRuntimeDeps {
  createExecutor?: (
    runtime: PiggyvestCaptureDrainRuntime
  ) => CaptureDrainExecutor;
  process?: DrainDeps['process'];
  now?: () => Date;
  nowMs?: () => number;
  /** Whether each primary intake can finish a replay on this host. */
  primaryIntake?: (env: NodeJS.ProcessEnv, now: Date) => PrimaryIntakeEvidence;
}

export async function runPiggyvestWebhookCaptureDrain(input: {
  env: NodeJS.ProcessEnv;
  deps?: CaptureDrainRuntimeDeps;
  limit?: number;
}): Promise<CaptureDrainRun> {
  const { env, deps = {} } = input;
  if (!isPiggyvestCaptureDrainEnabled(env)) return { status: 'disabled' };
  const runtime = readPiggyvestCaptureDrainRuntime(env);
  if (!runtime) return { status: 'unconfigured' };
  // A primary intake that is off or broken answers every replay 503, which
  // would spend the rows' attempt budget on a configuration gap. Leave the
  // unavailable families deferred without blocking ready families. A metadata
  // monitor still runs when all intakes are off, so parked reviews stay visible.
  const { notReady } = (deps.primaryIntake ?? collectPrimaryIntakeEvidence)(
    env,
    deps.now?.() ?? new Date()
  );
  const legacyReplayEnabled = isPiggyvestCaptureLegacyReplayEnabled(env);
  const legacyIntakeReady = isPiggyvestWebhookIntakeRuntimeReady(env);
  const executor = (deps.createExecutor ?? createCaptureDrainPgExecutor)(
    runtime
  );
  const queue = createPgCaptureQueue(executor);
  await monitorCaptureReviews(() => queue.status());
  if (
    legacyReplayEnabled &&
    !legacyIntakeReady &&
    notReady.includes('bank') &&
    notReady.includes('custody') &&
    notReady.includes('interest')
  )
    return { status: 'legacy_intake_not_ready' };
  if (
    !legacyReplayEnabled &&
    notReady.includes('bank') &&
    notReady.includes('custody') &&
    notReady.includes('interest')
  )
    return { status: 'intake_not_ready', notReady };
  const summary = await runCaptureDrainPass(
    {
      claim: (limit) => queue.claim(limit),
      renew: (id, token) => queue.renew(id, token),
      nowMs: deps.nowMs,
      resolve: (id, token, state, error) =>
        queue.resolve(id, token, state, error),
      verify: (delivery) =>
        verifyOnWorkerHost({
          ...delivery,
          env,
          now: deps.now?.() ?? new Date(),
        }),
      process:
        deps.process ?? ((delivery) => replayPrimaryDelivery(delivery, env)),
      deferBeforeReplay: (row) => {
        const family = primaryOwnerFamily(row.event_type ?? '');
        if (
          legacyReplayEnabled &&
          !legacyIntakeReady &&
          authorizesLegacyHandling(row.event_type ?? '', row.key_families) &&
          (!family || !row.key_families.includes(family))
        )
          return 'LEGACY_INTAKE_UNAVAILABLE';
        return family &&
          row.key_families.includes(family) &&
          notReady.some((unavailable) => unavailable === family)
          ? 'PRIMARY_INTAKE_UNAVAILABLE'
          : null;
      },
      outOfScope: (row) => workerHostReplayScope(row, legacyReplayEnabled),
    },
    { limit: input.limit ?? CAPTURE_DRAIN_BATCH, nowMs: deps.nowMs }
  );
  await monitorCaptureReviews(() => queue.status());
  return { status: 'drained', summary };
}
