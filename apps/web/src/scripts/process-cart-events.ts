import { pathToFileURL } from 'node:url';
import {
  type CartPublishResult,
  publishCartEvents,
} from '@/lib/cart/event-publisher';
import { createCartEventWorkerClient } from '@/lib/cart/event-worker-client';
import { createCartRetentionScheduler } from '@/lib/cart/retention-scheduler';

interface WorkerOptions {
  env?: Partial<NodeJS.ProcessEnv>;
  run?: () => Promise<CartPublishResult>;
  cleanup?: () => Promise<boolean>;
  logger?: {
    info: (message: string, metrics: Record<string, number>) => void;
    error: (message: string) => void;
  };
}
/** Disabled by default. This script never falls back to a service-role client. */
export async function runCartEventsOnce({
  env = process.env,
  run,
  cleanup,
  logger = console,
}: WorkerOptions = {}): Promise<number> {
  if (env.COMMERCE_CART_EVENTS_ENABLED !== 'true') return 0;
  try {
    if (!(await (cleanup ?? createCartRetentionScheduler({ env }))())) {
      logger.error('[cart-events] retention unavailable');
    }
  } catch {
    logger.error('[cart-events] retention unavailable');
  }
  try {
    const result = await (run?.() ??
      publishCartEvents(createCartEventWorkerClient(env), 'cart-events'));
    if (!result.ok) {
      logger.error('[cart-events] publisher unavailable');
      return 1;
    }
    if (result.sent || result.failed)
      logger.info('[cart-events] batch', {
        sent: result.sent,
        failed: result.failed,
        deadLettered: result.deadLettered,
      });
    return 0;
  } catch {
    logger.error('[cart-events] publisher unavailable');
    return 1;
  }
}
/** Loop polling cadence after a successful pass. */
export const CART_EVENTS_POLL_MS = 1_000;
/** First retry delay after a failed pass; doubles per failure. */
export const CART_EVENTS_RETRY_BASE_MS = 1_000;
/** Maximum retry delay: persistent misconfiguration backs off to a
 * one-minute cadence instead of a tight 1-second retry/log loop. */
export const CART_EVENTS_RETRY_MAX_MS = 60_000;

export function cartEventsRetryDelayMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return CART_EVENTS_POLL_MS;
  return Math.min(
    CART_EVENTS_RETRY_MAX_MS,
    CART_EVENTS_RETRY_BASE_MS * 2 ** (consecutiveFailures - 1)
  );
}

async function main(): Promise<void> {
  await import('dotenv/config');
  const args = process.argv.slice(2);
  if (
    args.length > 1 ||
    args.some((arg) => !['--once', '--loop'].includes(arg))
  ) {
    console.error('[cart-events] use --once or --loop');
    process.exitCode = 1;
    return;
  }
  const loop = args.includes('--loop');
  let stopped = false;
  const cleanup = createCartRetentionScheduler();
  const stop = () => {
    stopped = true;
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  let consecutiveFailures = 0;
  do {
    const status = await runCartEventsOnce({ cleanup });
    if (status !== 0 && !loop) {
      process.exitCode = status;
      break;
    }
    // In --loop mode a failed pass is retryable: the worker token may
    // rotate between passes, so retry instead of exiting on the first
    // failure near a rotation boundary — but back off exponentially
    // (capped at CART_EVENTS_RETRY_MAX_MS) so a persistently
    // misconfigured worker does not spin at one pass per second.
    consecutiveFailures = status === 0 ? 0 : consecutiveFailures + 1;
    if (loop && !stopped)
      await new Promise((resolve) =>
        setTimeout(resolve, cartEventsRetryDelayMs(consecutiveFailures))
      );
  } while (loop && !stopped);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main().catch(() => {
    console.error('[cart-events] startup failed');
    process.exitCode = 1;
  });
}
