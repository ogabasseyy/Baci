import type { StorefrontInternalPreflightSurface } from './storefront-internal-preflight';

export type StorefrontPreflightRpcOutcome =
  | 'success'
  | 'empty-result'
  | 'client-timeout'
  | 'database-timeout'
  | 'fetch-error'
  | 'rpc-error'
  | 'parse-error';

export interface StorefrontPreflightRpcAttemptProperties {
  attemptId?: string;
  deadlineMs?: number;
  elapsedMs?: number;
  outcome?: StorefrontPreflightRpcOutcome;
  rpcName?: string;
}

export interface StorefrontPreflightRpcAttempt
  extends StorefrontPreflightRpcAttemptProperties {
  attemptId: string;
  deadlineMs: number;
  elapsedMs: number;
  outcome: StorefrontPreflightRpcOutcome;
  rpcName: string;
  surface: StorefrontInternalPreflightSurface;
}

interface StorefrontPreflightRpcAttemptOptions {
  deadlineMs: number;
  rpcName: string;
  surface: StorefrontInternalPreflightSurface;
}

let fallbackAttemptCounter = 0;

function newAttemptId(): string {
  try {
    const uuid = globalThis.crypto?.randomUUID();
    if (typeof uuid === 'string' && uuid.length > 0) {
      return uuid;
    }
  } catch {
    // Fall through to the counter fallback below.
  }
  fallbackAttemptCounter += 1;
  return `preflight-fallback-${fallbackAttemptCounter}`;
}

function monotonicNow(): number {
  try {
    return performance.now();
  } catch {
    return Date.now();
  }
}

export function createStorefrontPreflightRpcAttemptRecorder(
  options: StorefrontPreflightRpcAttemptOptions
) {
  // Total by construction (never-throws fail-open contract): ID and
  // clock each degrade instead of throwing when the runtime lacks
  // crypto.randomUUID or performance.now.
  const attemptId = newAttemptId();
  const startedAt = monotonicNow();

  return (outcome: StorefrontPreflightRpcOutcome) => {
    const attempt: StorefrontPreflightRpcAttempt = {
      attemptId,
      deadlineMs: options.deadlineMs,
      elapsedMs: Math.max(0, Math.round(monotonicNow() - startedAt)),
      outcome,
      rpcName: options.rpcName,
      surface: options.surface,
    };

    try {
      console.info('[storefront-preflight-rpc] attempt', {
        attempt_id: attempt.attemptId,
        deadline_ms: attempt.deadlineMs,
        elapsed_ms: attempt.elapsedMs,
        outcome: attempt.outcome,
        rpc_name: attempt.rpcName,
        surface: attempt.surface,
      });
    } catch {
      // Telemetry must never change the fail-open or navigation behavior.
    }

    return attempt;
  };
}
