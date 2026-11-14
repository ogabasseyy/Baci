import 'server-only';
import {
  type DrainDeps,
  type DrainSummary,
  drainPiggyvestWebhookCaptures,
} from './webhook-capture-drain';

/** Admit work for ten seconds, reserving the rest of the 50s cron bound for
 * the current replay and settlement. Never pre-lease a batch of future work. */
export async function runCaptureDrainPass(
  deps: DrainDeps,
  options: { limit: number; nowMs?: () => number }
): Promise<DrainSummary> {
  const nowMs = options.nowMs ?? (() => performance.now());
  const deadline = nowMs() + 10_000;
  const total: DrainSummary = {
    claimed: 0,
    processed: 0,
    retried: 0,
    needsReview: 0,
  };
  const limit = Math.min(10, Math.max(1, options.limit));
  while (total.claimed < limit && nowMs() < deadline) {
    const pass = await drainPiggyvestWebhookCaptures(deps, { limit: 1 });
    for (const key of [
      'claimed',
      'processed',
      'retried',
      'needsReview',
    ] as const)
      total[key] += pass[key];
    if (pass.claimed === 0) break;
  }
  return total;
}
