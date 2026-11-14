import { createHash, randomUUID } from 'node:crypto';
import { hasValidCronSecret } from '@/lib/cron-secret-auth';
import { readOxygenCallbackBacklog } from '@/lib/payments/oxygen/runtime-callback-backlog';
import { readOxygenRuntimeConfiguration } from '@/lib/payments/oxygen/runtime-configuration';
import { connectOxygenRuntime } from '@/lib/payments/oxygen/runtime-connection';
import { reconcileOxygenCallbacks } from '@/lib/payments/oxygen/runtime-reconciliation';
import {
  readSupportedBanks,
  refreshSupportedBanks,
} from '@/lib/payments/oxygen/supported-bank-cache';
import { getRedis } from '@/lib/redis';

// Next.js requires a statically analyzable route-config literal.
export const maxDuration = 300;
const headers = { 'Cache-Control': 'no-store' };
const BACKLOG_ALERT_AGE_SECONDS = 15 * 60;
const REFRESH_BANKS_TASK = 'refresh-banks';
const ENSURE_BANKS_TASK = 'ensure-banks';
const BANK_RECOVERY_LOCK_SECONDS = maxDuration + 30;

/**
 * The bank-list jobs share this authenticated endpoint. Weekly refresh keeps
 * the list current; recovery checks every ten minutes and contacts Oxygen only
 * when the cache is missing.
 */
async function refreshBankCache(onlyIfMissing = false): Promise<Response> {
  let heldLock:
    | {
        cache: NonNullable<ReturnType<typeof getRedis>>;
        key: string;
        token: string;
      }
    | undefined;
  try {
    const config = readOxygenRuntimeConfiguration();
    const cache = getRedis();
    if (!config || !cache) throw new Error('Unavailable');
    if (onlyIfMissing) {
      const existing = await readSupportedBanks(
        cache,
        config.environment,
        config.reference
      );
      if (existing) return Response.json({ status: 'available' }, { headers });
    }
    const partnerHash = createHash('sha256')
      .update(config.reference)
      .digest('hex');
    const lockKey = `oxygen:supported-banks-recovery:${config.environment}:${partnerHash}`;
    const token = randomUUID();
    const lock = await cache.set(lockKey, token, {
      nx: true,
      ex: BANK_RECOVERY_LOCK_SECONDS,
    });
    if (lock !== 'OK')
      return Response.json(
        { status: 'recovery_in_progress' },
        {
          status: 202,
          headers: {
            ...headers,
            'Retry-After': String(BANK_RECOVERY_LOCK_SECONDS),
          },
        }
      );
    heldLock = { cache, key: lockKey, token };
    if (onlyIfMissing) {
      if (await readSupportedBanks(cache, config.environment, config.reference))
        return Response.json({ status: 'available' }, { headers });
    }
    const connection = connectOxygenRuntime();
    if (!connection || connection.provider.environment !== config.environment)
      throw new Error('Unavailable');
    const banks = await refreshSupportedBanks(
      cache,
      connection.provider,
      config.environment,
      config.reference
    );
    return Response.json({ count: banks.length }, { headers });
  } catch {
    return Response.json(
      { error: 'Bank list refresh unavailable' },
      { status: 503, headers }
    );
  } finally {
    if (heldLock) {
      try {
        await heldLock.cache.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          [heldLock.key],
          [heldLock.token]
        );
      } catch {
        // The short TTL still bounds recovery if Redis is unavailable.
        console.error('Oxygen supported-bank recovery lock release failed');
      }
    }
  }
}

// The VPS schedule invokes this endpoint; the drain remains disabled by default.
export async function GET(request: Request) {
  const deadlineMs = Date.now() + maxDuration * 1000;
  if (!hasValidCronSecret(request.headers, process.env.CRON_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  }
  const task = new URL(request.url).searchParams.get('task');
  if (task === REFRESH_BANKS_TASK) return refreshBankCache();
  if (task === ENSURE_BANKS_TASK) return refreshBankCache(true);
  if (process.env.OXYGEN_CALLBACK_DRAIN_ENABLED !== 'true') {
    return Response.json({ enabled: false }, { headers });
  }

  try {
    const connection = connectOxygenRuntime();
    if (!connection) throw new Error('Runtime unavailable');
    const worker = await connection.worker();
    await reconcileOxygenCallbacks(
      worker,
      connection.provider,
      connection.partnerReference,
      connection.hosts,
      async (workflow, callbackId, retryKey) => {
        await connection.reconcilePaymentCallback(
          worker,
          workflow,
          callbackId,
          retryKey
        );
      },
      undefined,
      { deadlineMs }
    );
    const backlog = await readOxygenCallbackBacklog(
      worker,
      connection.partnerReference
    );
    if ((backlog.oldestAgeSeconds ?? 0) >= BACKLOG_ALERT_AGE_SECONDS) {
      return Response.json(
        {
          error: 'Callback backlog requires attention',
          code: 'oxygen_callback_backlog',
        },
        { status: 503, headers }
      );
    }
    return Response.json({ enabled: true, backlog }, { headers });
  } catch {
    return Response.json(
      { error: 'Callback drain unavailable' },
      { status: 503, headers }
    );
  }
}
