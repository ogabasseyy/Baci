import { getPostHogReleaseContext } from '@/lib/posthog/config';
import {
  captureServerEvent,
  captureServerException,
} from '@/lib/posthog/server';

type MobileSignupLifecycleStage =
  | 'facts_read'
  | 'homepage'
  | 'input'
  | 'provisioning'
  | 'rpc';

interface MobileSignupLifecycleInput {
  attemptId: string | null;
  captureException?: boolean;
  durationMs: number;
  error?: unknown;
  eventCode: string;
  failureClass?:
    | 'conflict'
    | 'database'
    | 'homepage'
    | 'identity'
    | 'validation';
  httpStatus: number;
  outcome: 'failed' | 'succeeded';
  platform: 'android' | 'ios' | null;
  postgresCode?: string | null;
  stage: MobileSignupLifecycleStage;
}

const SAFE_POSTGRES_CODE = /^[A-Za-z0-9_]{1,16}$/;

export async function recordMobileSignupLifecycle({
  attemptId,
  captureException = false,
  durationMs,
  error,
  eventCode,
  failureClass,
  httpStatus,
  outcome,
  platform,
  postgresCode,
  stage,
}: MobileSignupLifecycleInput): Promise<void> {
  const releaseContext = getPostHogReleaseContext(process.env);
  const properties = {
    duration_ms: Math.max(0, Math.round(durationMs)),
    event_code: eventCode,
    ...(failureClass ? { failure_class: failureClass } : {}),
    http_status: httpStatus,
    ...(platform ? { platform } : {}),
    ...(postgresCode && SAFE_POSTGRES_CODE.test(postgresCode)
      ? { postgres_code: postgresCode }
      : {}),
    ...(attemptId ? { signup_attempt_id: attemptId } : {}),
    signup_flow: 'merchant',
    signup_outcome: outcome,
    signup_stage: stage,
    telemetry_source: 'provisioning_api',
    ...releaseContext,
  };
  const captured = await captureServerEvent(
    'admin_signup_lifecycle',
    properties
  );

  if (!captured) {
    console.warn(
      'mobile_signup_lifecycle_telemetry_gap %s',
      JSON.stringify({
        event_code: eventCode,
        ...(failureClass ? { failure_class: failureClass } : {}),
        http_status: httpStatus,
        signup_stage: stage,
        ...releaseContext,
      })
    );
  }

  if (captureException && error !== undefined) {
    await captureServerException(error, {
      event_code: eventCode,
      ...(failureClass ? { failure_class: failureClass } : {}),
      ...(postgresCode && SAFE_POSTGRES_CODE.test(postgresCode)
        ? { postgres_code: postgresCode }
        : {}),
      route_path: '/api/mobile/merchant-provisioning',
      signup_stage: stage,
    });
  }
}
