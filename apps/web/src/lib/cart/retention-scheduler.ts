import { createCartEventWorkerClient } from './event-worker-client';

interface RetentionRpcClient {
  rpc(
    name: 'cleanup_commerce_carts'
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

const RETENTION_INTERVAL_MS = 5 * 60 * 1000;
const RETENTION_RETRY_BASE_MS = 30 * 1000;

/** One scheduler per worker loop; authority is reloaded for every due RPC. */
export function createCartRetentionScheduler({
  env = process.env,
  client = () => createCartEventWorkerClient(env),
  now = Date.now,
}: {
  env?: Partial<NodeJS.ProcessEnv>;
  client?: () => RetentionRpcClient;
  now?: () => number;
} = {}): () => Promise<boolean> {
  let lastSuccess: number | null = null;
  let consecutiveFailures = 0;
  let nextAttemptAt = 0;
  return async () => {
    if (lastSuccess !== null && now() - lastSuccess < RETENTION_INTERVAL_MS)
      return true;
    // A failed cleanup backs off exponentially (30s doubling to the
    // five-minute interval) instead of retrying on every worker pass;
    // deferred passes report success so the loop does not log spam.
    if (now() < nextAttemptAt) return true;
    try {
      const { error } = await client().rpc('cleanup_commerce_carts');
      if (error) {
        consecutiveFailures += 1;
        nextAttemptAt =
          now() +
          Math.min(
            RETENTION_INTERVAL_MS,
            RETENTION_RETRY_BASE_MS * 2 ** (consecutiveFailures - 1)
          );
        return false;
      }
      lastSuccess = now();
      consecutiveFailures = 0;
      nextAttemptAt = 0;
      return true;
    } catch {
      consecutiveFailures += 1;
      nextAttemptAt =
        now() +
        Math.min(
          RETENTION_INTERVAL_MS,
          RETENTION_RETRY_BASE_MS * 2 ** (consecutiveFailures - 1)
        );
      return false;
    }
  };
}
