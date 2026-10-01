import { after, type NextRequest, NextResponse } from 'next/server';
import { constantTimeEqual } from '@/lib/constant-time-equal';
import { logger } from '@/lib/logger';
import { recordMerchantSignupHealthTelemetry } from '@/lib/posthog/merchant-signup-health-telemetry';
import { createPublicClient } from '@/lib/supabase/public';

interface MerchantSignupPolicyHealth {
  alias_row_level_security_enabled: boolean;
  alias_select_policy_is_expected: boolean;
  anon_can_read_alias_merchant_id: boolean;
  anon_can_read_alias_old_slug: boolean;
  anon_can_read_merchant_id: boolean;
  anon_can_read_merchant_slug: boolean;
  anon_can_use_public_schema: boolean;
  anon_has_no_alias_table_select: boolean;
  anon_has_no_merchant_table_select: boolean;
  anon_select_policy_is_expected: boolean;
  auth_can_execute_reserved_slug_check: boolean;
  auth_can_execute_slug_generator: boolean;
  auth_can_execute_mobile_provisioning_rpc: boolean;
  auth_can_insert: boolean;
  auth_can_read_alias_merchant_id: boolean;
  auth_can_read_alias_old_slug: boolean;
  auth_can_use_public_schema: boolean;
  auth_can_update: boolean;
  auth_has_no_alias_table_select: boolean;
  auth_has_no_table_select: boolean;
  can_read_business_name: boolean;
  can_read_id: boolean;
  can_read_slug: boolean;
  can_read_user_id: boolean;
  insert_policy_allows_owner: boolean;
  no_restrictive_alias_select_policies: boolean;
  no_restrictive_anon_merchant_select_policies: boolean;
  no_restrictive_signup_policies: boolean;
  no_unexpected_permissive_anon_merchant_select_policies: boolean;
  no_unexpected_permissive_signup_policies: boolean;
  mobile_provisioning_rpc_is_invoker: boolean;
  anon_cannot_execute_mobile_provisioning_rpc: boolean;
  public_cannot_execute_mobile_provisioning_rpc: boolean;
  domain_insert_policy_is_expected: boolean;
  staff_insert_policy_is_expected: boolean;
  staff_update_policy_is_expected: boolean;
  row_level_security_enabled: boolean;
  select_policy_is_expected: boolean;
  update_policy_allows_owner_or_staff: boolean;
}

const DEPLOYMENT_FAULT_LOG_TAG = 'mobile-onboarding deployment_fault';

function scheduleMerchantSignupHealthTelemetry(
  input: Parameters<typeof recordMerchantSignupHealthTelemetry>[0]
) {
  after(async () => {
    try {
      await recordMerchantSignupHealthTelemetry(input);
    } catch (error) {
      logger.warn({
        message: 'merchant_signup_health_telemetry_failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  });
}

function isMerchantSignupPolicyHealth(
  value: unknown
): value is MerchantSignupPolicyHealth {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Record<string, unknown>;
  return [
    candidate.alias_row_level_security_enabled,
    candidate.alias_select_policy_is_expected,
    candidate.anon_can_read_alias_merchant_id,
    candidate.anon_can_read_alias_old_slug,
    candidate.anon_can_read_merchant_id,
    candidate.anon_can_read_merchant_slug,
    candidate.anon_can_use_public_schema,
    candidate.anon_has_no_alias_table_select,
    candidate.anon_has_no_merchant_table_select,
    candidate.anon_select_policy_is_expected,
    candidate.auth_can_execute_reserved_slug_check,
    candidate.auth_can_execute_slug_generator,
    candidate.auth_can_execute_mobile_provisioning_rpc,
    candidate.auth_can_insert,
    candidate.auth_can_read_alias_merchant_id,
    candidate.auth_can_read_alias_old_slug,
    candidate.auth_can_use_public_schema,
    candidate.auth_can_update,
    candidate.auth_has_no_alias_table_select,
    candidate.auth_has_no_table_select,
    candidate.can_read_business_name,
    candidate.can_read_id,
    candidate.can_read_slug,
    candidate.can_read_user_id,
    candidate.insert_policy_allows_owner,
    candidate.no_restrictive_alias_select_policies,
    candidate.no_restrictive_anon_merchant_select_policies,
    candidate.no_restrictive_signup_policies,
    candidate.no_unexpected_permissive_anon_merchant_select_policies,
    candidate.no_unexpected_permissive_signup_policies,
    candidate.mobile_provisioning_rpc_is_invoker,
    candidate.anon_cannot_execute_mobile_provisioning_rpc,
    candidate.public_cannot_execute_mobile_provisioning_rpc,
    candidate.domain_insert_policy_is_expected,
    candidate.staff_insert_policy_is_expected,
    candidate.staff_update_policy_is_expected,
    candidate.row_level_security_enabled,
    candidate.select_policy_is_expected,
    candidate.update_policy_allows_owner_or_staff,
  ].every((invariant) => typeof invariant === 'boolean');
}

function failedInvariants(health: MerchantSignupPolicyHealth): string[] {
  return Object.entries(health)
    .filter(([, healthy]) => !healthy)
    .map(([name]) => name);
}

function readMerchantSignupPolicyHealth() {
  const supabase = createPublicClient({
    clientInfo: 'baci-merchant-signup-health',
    timeoutMs: 10_000,
  });
  return supabase.rpc('get_merchant_signup_policy_health');
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (
    !authHeader ||
    !cronSecret ||
    !constantTimeEqual(authHeader, `Bearer ${cronSecret}`)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  let result: Awaited<ReturnType<typeof readMerchantSignupPolicyHealth>>;
  try {
    result = await readMerchantSignupPolicyHealth();
  } catch (error) {
    logger.error({
      message: DEPLOYMENT_FAULT_LOG_TAG,
      component: 'merchant_signup_policy_health',
      reason: 'health_rpc_threw',
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    scheduleMerchantSignupHealthTelemetry({
      durationMs: Date.now() - startedAt,
      error,
      outcome: 'unavailable',
      reason: 'health_rpc_threw',
    });
    return NextResponse.json(
      { error: 'Merchant signup health check failed' },
      { status: 500 }
    );
  }
  const { data, error } = result;

  if (error || !isMerchantSignupPolicyHealth(data)) {
    const reason = error ? 'health_rpc_failed' : 'invalid_health_result';
    logger.error({
      message: DEPLOYMENT_FAULT_LOG_TAG,
      component: 'merchant_signup_policy_health',
      reason,
      pgCode: error?.code,
    });
    scheduleMerchantSignupHealthTelemetry({
      durationMs: Date.now() - startedAt,
      ...(error ? { error } : {}),
      outcome: 'unavailable',
      ...(error?.code ? { postgresCode: error.code } : {}),
      reason,
    });
    return NextResponse.json(
      { error: 'Merchant signup health check failed' },
      { status: 500 }
    );
  }

  const failed = failedInvariants(data);
  if (failed.length > 0) {
    logger.error({
      message: DEPLOYMENT_FAULT_LOG_TAG,
      component: 'merchant_signup_policy_health',
      reason: 'policy_drift_detected',
      failedInvariants: failed,
    });
    scheduleMerchantSignupHealthTelemetry({
      durationMs: Date.now() - startedAt,
      failedInvariants: failed,
      outcome: 'degraded',
      reason: 'policy_drift_detected',
    });
    return NextResponse.json(
      { healthy: false, failed_invariants: failed },
      { status: 503 }
    );
  }

  scheduleMerchantSignupHealthTelemetry({
    durationMs: Date.now() - startedAt,
    failedInvariants: [],
    outcome: 'healthy',
    reason: 'all_invariants_healthy',
  });
  return NextResponse.json({ healthy: true });
}
