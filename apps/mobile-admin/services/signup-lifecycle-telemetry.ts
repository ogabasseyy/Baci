import NetInfo from '@react-native-community/netinfo';
import * as Application from 'expo-application';
import { getAuthErrorCode } from '@/lib/auth/auth-error-classification';
import { signupAttemptIdSchema } from '@/schemas/signup-attempt-id';
import { getAdminPostHog, initAdminAnalytics } from '@/services/analytics-core';
import { sanitizeAdminAnalyticsProperties } from './analytics-privacy';

export type SignupFlow = 'merchant' | 'staff';
export type SignupStage = 'auth' | 'verification' | 'provisioning';
export type SignupOutcome =
  | 'started'
  | 'retrying'
  | 'succeeded'
  | 'failed'
  | 'verification_required'
  | 'account_exists'
  | 'completed';
export type SignupFailureClass =
  | 'account_exists'
  | 'auth_provider'
  | 'connectivity_dns'
  | 'connectivity_transport'
  | 'incomplete_response'
  | 'invalid_verification'
  | 'password_breached'
  | 'rate_limited'
  | 'server'
  | 'server_rejected'
  | 'timeout'
  | 'unexpected';

export interface MobileSignupLifecycleInput {
  attemptId: string | null | undefined;
  durationMs?: number;
  error?: unknown;
  eventCode: string;
  failureClass?: SignupFailureClass;
  flow: SignupFlow;
  outcome: SignupOutcome;
  retryAttempted?: boolean;
  stage: SignupStage;
}

const SAFE_ERROR_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

function getSafeErrorCode(error: unknown): string {
  const code = getAuthErrorCode(error);
  return code && SAFE_ERROR_CODE_PATTERN.test(code) ? code : 'unavailable';
}

function getSafeErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;

  const status =
    'status' in error &&
    typeof error.status === 'number' &&
    Number.isFinite(error.status)
      ? error.status
      : 'statusCode' in error &&
          typeof error.statusCode === 'number' &&
          Number.isFinite(error.statusCode)
        ? error.statusCode
        : null;
  return status;
}

/** Captures a privacy-safe mobile signup step without changing auth behavior. */
export async function captureMobileSignupLifecycle({
  attemptId,
  durationMs,
  error,
  eventCode,
  failureClass,
  flow,
  outcome,
  retryAttempted = false,
  stage,
}: MobileSignupLifecycleInput): Promise<void> {
  let client = getAdminPostHog();
  if (!client) {
    if (!initAdminAnalytics()) return;
    client = getAdminPostHog();
  }
  if (!client) return;

  let networkSnapshot:
    | {
        isConnected: boolean | null;
        isInternetReachable: boolean | null;
        type: string;
      }
    | undefined;

  const needsNetworkSnapshot =
    failureClass === 'connectivity_dns' ||
    failureClass === 'connectivity_transport' ||
    failureClass === 'timeout' ||
    outcome === 'retrying';
  if (needsNetworkSnapshot) {
    try {
      const state = await NetInfo.fetch();
      networkSnapshot = {
        isConnected: state.isConnected,
        isInternetReachable: state.isInternetReachable,
        type: state.type,
      };
    } catch {
      // Lifecycle telemetry remains useful when the snapshot is missing.
    }
  }

  const parsedAttemptId = signupAttemptIdSchema.safeParse(attemptId);

  try {
    client.capture(
      'admin_signup_lifecycle',
      sanitizeAdminAnalyticsProperties({
        app_surface: 'mobile-admin',
        ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
        error_code: getSafeErrorCode(error),
        error_status: getSafeErrorStatus(error),
        event_code: eventCode,
        ...(failureClass ? { failure_class: failureClass } : {}),
        native_app_version: Application.nativeApplicationVersion,
        native_build_version: Application.nativeBuildVersion,
        network_is_connected: networkSnapshot?.isConnected ?? null,
        network_is_internet_reachable:
          networkSnapshot?.isInternetReachable ?? null,
        network_snapshot_available: networkSnapshot !== undefined,
        network_type: networkSnapshot?.type ?? 'unknown',
        retry_attempted: retryAttempted,
        ...(parsedAttemptId.success
          ? { signup_attempt_id: parsedAttemptId.data }
          : {}),
        signup_flow: flow,
        signup_outcome: outcome,
        signup_stage: stage,
        telemetry_source: 'mobile',
      }) ?? {}
    );
  } catch {
    // Observability must never change or block the authentication result.
  }
}
