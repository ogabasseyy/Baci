import { getPostHogReleaseContext } from '@/lib/posthog/config';
import {
  captureServerEvent,
  captureServerException,
} from '@/lib/posthog/server';

interface MerchantSignupHealthTelemetryInput {
  durationMs: number;
  error?: unknown;
  failedInvariants?: string[];
  outcome: 'degraded' | 'healthy' | 'unavailable';
  postgresCode?: string;
  reason: string;
}

const SAFE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const SAFE_POSTGRES_CODE = /^[A-Za-z0-9_]{1,16}$/;

export async function recordMerchantSignupHealthTelemetry({
  durationMs,
  error,
  failedInvariants = [],
  outcome,
  postgresCode,
  reason,
}: MerchantSignupHealthTelemetryInput): Promise<void> {
  const safeInvariants = failedInvariants.filter((value) =>
    SAFE_IDENTIFIER.test(value)
  );
  const properties = {
    duration_ms: Math.max(0, Math.round(durationMs)),
    failed_invariant_count: safeInvariants.length,
    failed_invariants: safeInvariants,
    health_component: 'merchant_signup_policy',
    health_outcome: outcome,
    ...(postgresCode && SAFE_POSTGRES_CODE.test(postgresCode)
      ? { postgres_code: postgresCode }
      : {}),
    reason: SAFE_IDENTIFIER.test(reason) ? reason : 'unavailable',
    telemetry_source: 'scheduled_health_check',
    ...getPostHogReleaseContext(process.env),
  };
  const captured = await captureServerEvent('admin_signup_health', properties);

  if (!captured) {
    console.warn(
      'merchant_signup_health_telemetry_gap %s',
      JSON.stringify(properties)
    );
  }

  if (error !== undefined) {
    await captureServerException(error, {
      health_component: 'merchant_signup_policy',
      reason: properties.reason,
      route_path: '/api/cron/merchant-signup-health',
    });
  }
}
