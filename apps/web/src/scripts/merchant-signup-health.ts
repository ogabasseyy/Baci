import 'dotenv/config';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { logger } from '@/lib/logger';
import { recordMerchantSignupHealthTelemetry } from '@/lib/posthog/merchant-signup-health-telemetry';
import { createPublicClient } from '@/lib/supabase/public';

const DEPLOYMENT_FAULT_LOG_TAG = 'mobile-onboarding deployment_fault';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export async function runMerchantSignupHealthCli(): Promise<number> {
  const startedAt = Date.now();
  const supabase = createPublicClient({
    clientInfo: 'baci-merchant-signup-health',
    timeoutMs: 10_000,
  });

  const { data, error } = await supabase.rpc('get_merchant_signup_policy_health');
  if (error || !isRecord(data)) {
    const reason = error ? 'health_rpc_failed' : 'invalid_health_result';
    logger.error({
      message: DEPLOYMENT_FAULT_LOG_TAG,
      component: 'merchant_signup_policy_health',
      reason,
      pgCode: error?.code,
    });
    await recordMerchantSignupHealthTelemetry({
      durationMs: Date.now() - startedAt,
      ...(error ? { error } : {}),
      outcome: 'unavailable',
      ...(error?.code ? { postgresCode: error.code } : {}),
      reason,
    }).catch(() => undefined);
    return 1;
  }

  const failed = Object.entries(data)
    .filter(([, healthy]) => healthy !== true)
    .map(([name]) => name);

  if (failed.length > 0) {
    logger.error({
      message: DEPLOYMENT_FAULT_LOG_TAG,
      component: 'merchant_signup_policy_health',
      reason: 'policy_drift_detected',
      failedInvariants: failed,
    });
    await recordMerchantSignupHealthTelemetry({
      durationMs: Date.now() - startedAt,
      failedInvariants: failed,
      outcome: 'degraded',
      reason: 'policy_drift_detected',
    }).catch(() => undefined);
    console.error(JSON.stringify({ healthy: false, failed_invariants: failed }));
    return 1;
  }

  await recordMerchantSignupHealthTelemetry({
    durationMs: Date.now() - startedAt,
    failedInvariants: [],
    outcome: 'healthy',
    reason: 'all_invariants_healthy',
  }).catch(() => undefined);
  console.log(JSON.stringify({ healthy: true }));
  return 0;
}

const currentFile = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;

if (import.meta.url === currentFile) {
  runMerchantSignupHealthCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(
        error instanceof Error ? error.stack || error.message : error
      );
      process.exitCode = 1;
    });
}
