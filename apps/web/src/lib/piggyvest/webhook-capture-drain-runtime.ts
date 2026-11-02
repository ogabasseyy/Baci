import 'server-only';
import {
  PIGGYVEST_CAPTURE_DRAIN_LOGIN,
  type PiggyvestCaptureDrainRuntime,
  piggyvestCaptureDrainRuntimeSchema,
} from '@/schemas/piggyvest/webhook-capture-drain-runtime';
import { isPiggyvestCaptureDrainEnabled } from './webhook-capture-attestation';
import {
  type DrainDeps,
  type DrainSummary,
  drainPiggyvestWebhookCaptures,
} from './webhook-capture-drain';
import { workerHostReplayScope } from './webhook-capture-drain-scope';
import { verifyOnWorkerHost } from './webhook-capture-host-verify';
import {
  type CaptureDrainExecutor,
  createCaptureDrainPgExecutor,
} from './webhook-capture-pg-executor';
import { replayPrimaryDelivery } from './webhook-capture-primary-replay';
import { createPgCaptureQueue } from './webhook-capture-queue';

/**
 * The worker-host capture drain (R5): one bounded pass over the captured
 * PiggyVest deliveries, run every minute by cron.
 *
 * Dark by default. Unless PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_ENABLED is
 * exactly 'true' on the host it reads no configuration and opens no
 * connection. When enabled it connects only as the dedicated drain login
 * (never a service-role key), re-verifies every stored signature (a row
 * signed by a key this host does not hold is deferred, never parked),
 * replays rows a primary intake owns through that intake's own login, and
 * sets legacy-family rows aside for review with an alert. Replay is
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
  | { status: 'drained'; summary: DrainSummary };

export interface CaptureDrainRuntimeDeps {
  createExecutor?: (
    runtime: PiggyvestCaptureDrainRuntime
  ) => CaptureDrainExecutor;
  process?: DrainDeps['process'];
  now?: () => Date;
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
  const executor = (deps.createExecutor ?? createCaptureDrainPgExecutor)(
    runtime
  );
  const queue = createPgCaptureQueue(executor);
  const summary = await drainPiggyvestWebhookCaptures(
    {
      claim: (limit) => queue.claim(limit),
      resolve: (id, token, state, error) =>
        queue.resolve(id, token, state, error),
      verify: (delivery) =>
        verifyOnWorkerHost({
          ...delivery,
          env,
          now: deps.now?.() ?? new Date(),
        }),
      process: deps.process ?? replayPrimaryDelivery,
      outOfScope: workerHostReplayScope,
    },
    { limit: input.limit ?? CAPTURE_DRAIN_BATCH }
  );
  return { status: 'drained', summary };
}
