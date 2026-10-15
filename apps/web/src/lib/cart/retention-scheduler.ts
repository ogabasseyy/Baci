import { createCartEventWorkerClient } from './event-worker-client';

interface RetentionRpcClient {
  rpc(
    name: 'cleanup_commerce_carts'
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

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
  const intervalMs = 5 * 60 * 1000;
  let lastSuccess: number | null = null;
  return async () => {
    if (lastSuccess !== null && now() - lastSuccess < intervalMs) return true;
    try {
      const { error } = await client().rpc('cleanup_commerce_carts');
      if (error) return false;
      lastSuccess = now();
      return true;
    } catch {
      return false;
    }
  };
}
