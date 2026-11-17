import 'dotenv/config';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { logger } from '@/lib/logger';
import { recordMerchantSignupHealthTelemetry } from '@/lib/posthog/merchant-signup-health-telemetry';
import { createPublicClient } from '@/lib/supabase/public';

const DEPLOYMENT_FAULT_LOG_TAG = 'mobile-onboarding deployment_fault';

const REQUIRED_HEALTH_INVARIANTS = [
  'alias_row_level_security_enabled',
  'alias_select_policy_is_expected',
  'anon_can_read_alias_merchant_id',
  'anon_can_read_alias_old_slug',
  'anon_can_read_merchant_id',
  'anon_can_read_merchant_slug',
  'anon_can_use_public_schema',
  'anon_has_no_alias_table_select',
  'anon_has_no_merchant_table_select',
  'anon_select_policy_is_expected',
  'auth_can_execute_reserved_slug_check',
  'auth_can_execute_slug_generator',
  'auth_can_execute_mobile_provisioning_rpc',
  'auth_can_insert',
  'auth_can_read_alias_merchant_id',
  'auth_can_read_alias_old_slug',
  'auth_can_use_public_schema',
  'auth_can_update',
  'auth_has_no_alias_table_select',
  'auth_has_no_table_select',
  'can_read_business_name',
  'can_read_id',
  'can_read_slug',
  'can_read_user_id',
  'insert_policy_allows_owner',
  'no_restrictive_alias_select_policies',
  'no_restrictive_anon_merchant_select_policies',
  'no_restrictive_signup_policies',
  'no_unexpected_permissive_anon_merchant_select_policies',
  'no_unexpected_permissive_signup_policies',
  'mobile_provisioning_rpc_is_invoker',
  'anon_cannot_execute_mobile_provisioning_rpc',
  'public_cannot_execute_mobile_provisioning_rpc',
  'domain_insert_policy_is_expected',
  'staff_insert_policy_is_expected',
  'staff_update_policy_is_expected',
  'row_level_security_enabled',
  'select_policy_is_expected',
  'update_policy_allows_owner_or_staff',
] as const;

function isMerchantSignupPolicyHealth(
  value: unknown
): value is Record<(typeof REQUIRED_HEALTH_INVARIANTS)[number], boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return REQUIRED_HEALTH_INVARIANTS.every(
    (key) => typeof candidate[key] === 'boolean'
  );
}

export async function runMerchantSignupHealthCli(): Promise<number> {
  const startedAt = Date.now();
  const supabase = createPublicClient({
    clientInfo: 'baci-merchant-signup-health',
    timeoutMs: 10_000,
  });

  const { data, error } = await supabase.rpc('get_merchant_signup_policy_health');
  if (error || !isMerchantSignupPolicyHealth(data)) {
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
