import { hasValidCronSecret } from '@/lib/cron-secret-auth';
import { readOxygenCallbackBacklog } from '@/lib/payments/oxygen/runtime-callback-backlog';
import { readOxygenRuntimeConfiguration } from '@/lib/payments/oxygen/runtime-configuration';
import { connectOxygenRuntime } from '@/lib/payments/oxygen/runtime-connection';
import { reconcileOxygenCallbacks } from '@/lib/payments/oxygen/runtime-reconciliation';
import { refreshSupportedBanks } from '@/lib/payments/oxygen/supported-bank-cache';
import { getRedis } from '@/lib/redis';

// Next.js requires a statically analyzable route-config literal.
export const maxDuration = 300;
const headers = { 'Cache-Control': 'no-store' };
const BACKLOG_ALERT_AGE_SECONDS = 15 * 60;
const REFRESH_BANKS_TASK = 'refresh-banks';

/**
 * The weekly bank-list refresh shares this endpoint so the app advertises one
 * cron route instead of two; `?task=refresh-banks` selects it before the
 * callback drain gate.
 */
async function refreshBankCache(): Promise<Response> {
  try {
    const config = readOxygenRuntimeConfiguration();
    const connection = connectOxygenRuntime();
    const cache = getRedis();
    if (
      !config ||
      !connection ||
      !cache ||
      connection.provider.environment !== config.environment
    )
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
  }
}

// The VPS schedule invokes this endpoint; the drain remains disabled by default.
export async function GET(request: Request) {
  const deadlineMs = Date.now() + maxDuration * 1000;
  if (!hasValidCronSecret(request.headers, process.env.CRON_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  }
  if (new URL(request.url).searchParams.get('task') === REFRESH_BANKS_TASK) {
    return refreshBankCache();
  }
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
