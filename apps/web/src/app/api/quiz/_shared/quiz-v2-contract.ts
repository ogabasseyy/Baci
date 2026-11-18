import {
  QUIZ_CONTRACT_HEADER,
  QUIZ_CONTRACT_VERSION,
} from '@baci/shared/constants';
import { type NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import type { ServerSupabaseClient } from './route-helpers-guards';

const UPDATE_REQUIRED = {
  code: 'QUIZ_APP_UPDATE_REQUIRED',
  error: 'Update the app to continue with this quiz.',
} as const;

const RUNTIME_NOT_READY = {
  code: 'QUIZ_RUNTIME_NOT_READY',
  error: 'Quiz is temporarily unavailable. Please try again soon.',
} as const;

export function requiresQuizV2(request: NextRequest): boolean {
  return (
    request.headers.get(QUIZ_CONTRACT_HEADER) === String(QUIZ_CONTRACT_VERSION)
  );
}

export function hasQuizContractHeader(request: NextRequest): boolean {
  return request.headers.has(QUIZ_CONTRACT_HEADER);
}

export function requireQuizV2Contract(
  request: NextRequest
): NextResponse | null {
  if (requiresQuizV2(request)) return null;
  return NextResponse.json(UPDATE_REQUIRED, { status: 426 });
}

export function rejectUnsupportedQuizContract(
  request: NextRequest
): NextResponse | null {
  const value = request.headers.get(QUIZ_CONTRACT_HEADER);
  if (value === null || value === String(QUIZ_CONTRACT_VERSION)) return null;
  return NextResponse.json(UPDATE_REQUIRED, { status: 426 });
}

/**
 * How long one web instance trusts a passing database readiness check.
 * The answer is the same for every player and only changes when a migration
 * ships, so asking the database on every request spent more than a third of
 * all quiz database calls on it during a load test. Only a pass is remembered:
 * a failed or wrong answer is asked again on the next request.
 */
const RUNTIME_READY_TTL_MS = 15_000;

let runtimeReadyUntil = 0;
function logRuntimeCheckFailure(reason: string, code?: string): void {
  logger.warn({
    code,
    event: 'quiz_runtime_contract_check',
    message: 'Quiz runtime contract check did not pass',
    reason,
  });
}

async function checkQuizV2Runtime(
  supabase: ServerSupabaseClient
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('quiz_runtime_contract_version');
    if (error) {
      logRuntimeCheckFailure('rpc_error', error.code);
      return false;
    }
    if (data !== QUIZ_CONTRACT_VERSION) {
      logRuntimeCheckFailure('version_mismatch');
      return false;
    }
    return true;
  } catch {
    logRuntimeCheckFailure('request_failed');
    return false;
  }
}

type RuntimeCheck = { ready: Promise<boolean>; startedAt: number };

let runtimeCheckInFlight: RuntimeCheck | null = null;

export async function requireQuizV2Runtime(
  supabase: ServerSupabaseClient
): Promise<NextResponse | null> {
  if (Date.now() < runtimeReadyUntil) return null;
  // Requests that arrive while a check is running share its answer instead of
  // each sending their own.
  if (!runtimeCheckInFlight) {
    const check: RuntimeCheck = {
      ready: checkQuizV2Runtime(supabase).finally(() => {
        if (runtimeCheckInFlight === check) runtimeCheckInFlight = null;
      }),
      startedAt: Date.now(),
    };
    runtimeCheckInFlight = check;
  }
  const { ready, startedAt } = runtimeCheckInFlight;
  if (!(await ready)) {
    return NextResponse.json(RUNTIME_NOT_READY, { status: 503 });
  }
  // Count the window from when the question was asked, so a slow database
  // answer cannot stretch how long a pass is trusted.
  runtimeReadyUntil = Math.max(
    runtimeReadyUntil,
    startedAt + RUNTIME_READY_TTL_MS
  );
  return null;
}

/** Test-only: forget the remembered readiness check. */
export function resetQuizV2RuntimeCheckForTests(): void {
  runtimeReadyUntil = 0;
  runtimeCheckInFlight = null;
}

export function readQuizDeviceFingerprint(request: NextRequest): string | null {
  const value = request.headers.get('X-Baci-Quiz-Device-Fingerprint')?.trim();
  return value && /^[0-9a-f]{64}$/.test(value) ? value : null;
}
