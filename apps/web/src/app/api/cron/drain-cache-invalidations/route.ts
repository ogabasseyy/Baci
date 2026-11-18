import { NextResponse } from 'next/server';
import { cacheInvalidationPurgeCausalKey } from '@/lib/cache-invalidation-purge-causal-key';
import { hasValidCronSecret } from '@/lib/cron-secret-auth';
import { drainStorefrontCacheInvalidation } from '@/lib/drain-storefront-cache-invalidation';
import { createServiceClient } from '@/lib/supabase/service';
import { cacheInvalidationDrainCronResponseSchemas } from '@/schemas/cache-invalidation-drain-cron';

export const maxDuration = 60;
const BATCH_SIZE = 5;
const TARGET_BUDGET = 10;
const CLAIM_CUTOFF_MS = 30_000;
// Report current dead-letter presence on every request. The VPS scheduler owns
// durable transition detection and repeated-alert suppression.

export async function GET(request: Request): Promise<NextResponse> {
  if (!hasValidCronSecret(request.headers, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const workerId = `next-cron-${startedAt}`;
  const supabase = createServiceClient('event-pipeline');
  let claimed = 0;
  let completed = 0;
  let failed = 0;
  // Within one cron invocation, a successful purge for merchant+generation
  // covers every outbox row that shares that causal identity. Later claim
  // batches must finish siblings without repeating provider work.
  const completedCausalKeys = new Set<string>();
  while (claimed < TARGET_BUDGET && Date.now() - startedAt < CLAIM_CUTOFF_MS) {
    const { data, error } = await supabase.rpc('claim_cache_invalidations', {
      p_batch_size: Math.min(BATCH_SIZE, TARGET_BUDGET - claimed),
      p_worker_id: workerId,
    });
    if (error) {
      return NextResponse.json(
        { error: 'Failed to claim invalidations' },
        { status: 500 }
      );
    }
    const parsed = cacheInvalidationDrainCronResponseSchemas.claims.safeParse(
      data ?? []
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid claim payload' },
        { status: 500 }
      );
    }
    if (parsed.data.length === 0) break;

    claimed += parsed.data.length;
    // Drain the batch concurrently so generation-fenced SingleFlight can
    // coalesce equivalent slug/hostname rows from one merchant mutation.
    const outcomes = await Promise.all(
      parsed.data.map(async (claim) => {
        const causalKey = cacheInvalidationPurgeCausalKey(claim);
        let result: Awaited<
          ReturnType<typeof drainStorefrontCacheInvalidation>
        >;
        if (completedCausalKeys.has(causalKey)) {
          result = { ok: true };
        } else {
          try {
            result = await drainStorefrontCacheInvalidation(claim);
          } catch {
            result = { errorCode: 'drain_unexpected_failure', ok: false };
          }
          if (result.ok) {
            completedCausalKeys.add(causalKey);
          }
        }
        const finish = await supabase.rpc('finish_cache_invalidation', {
          p_claim_token: claim.claim_token,
          p_generation: claim.generation,
          p_merchant_id: claim.merchant_id,
          p_succeeded: result.ok,
          p_target_id: claim.target_id,
          p_target_kind: claim.target_kind,
          ...(result.ok ? {} : { p_error_code: result.errorCode }),
          ...(result.ok || result.retryAfterSeconds === undefined
            ? {}
            : { p_retry_after_seconds: result.retryAfterSeconds }),
        });
        if (finish.error || finish.data !== true) {
          return { ok: false as const, persistFailed: true as const };
        }
        return { ok: result.ok, persistFailed: false as const };
      })
    );
    if (outcomes.some((outcome) => outcome.persistFailed)) {
      return NextResponse.json(
        { error: 'Failed to persist invalidation outcome' },
        { status: 500 }
      );
    }
    for (const outcome of outcomes) {
      if (outcome.ok) completed += 1;
      else failed += 1;
    }
  }

  const deadLetterResult = await supabase.rpc(
    'has_cache_invalidation_dead_letters'
  );
  const deadLetters =
    cacheInvalidationDrainCronResponseSchemas.deadLetters.safeParse(
      deadLetterResult.data
    );
  if (deadLetterResult.error || !deadLetters.success) {
    return NextResponse.json(
      { error: 'Failed to read invalidation alert state' },
      { status: 500 }
    );
  }
  const hasDeadLetters = deadLetters.data;
  return NextResponse.json({
    claimed,
    completed,
    failed,
    ...(hasDeadLetters
      ? { deadLettersPresent: true }
      : { deadLettersPresent: false }),
  });
}
