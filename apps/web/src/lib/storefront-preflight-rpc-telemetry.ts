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

export function createStorefrontPreflightRpcAttemptRecorder(
  options: StorefrontPreflightRpcAttemptOptions
) {
  const attemptId = globalThis.crypto.randomUUID();
  const startedAt = performance.now();

  return (outcome: StorefrontPreflightRpcOutcome) => {
    const attempt: StorefrontPreflightRpcAttempt = {
      attemptId,
      deadlineMs: options.deadlineMs,
      elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
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

export function getRpcAttemptProperties(
  context: StorefrontPreflightRpcAttemptProperties
): Record<string, unknown> {
  return {
    ...(context.attemptId ? { attempt_id: context.attemptId } : {}),
    ...(context.deadlineMs === undefined
      ? {}
      : { deadline_ms: context.deadlineMs }),
    ...(context.elapsedMs === undefined
      ? {}
      : { elapsed_ms: context.elapsedMs }),
    ...(context.outcome ? { outcome: context.outcome } : {}),
    ...(context.rpcName ? { rpc_name: context.rpcName } : {}),
  };
}

export function classifyStorefrontPreflightRpcOutcome(
  reason: 'timeout' | 'fetch-error' | 'has-error',
  code?: string
): StorefrontPreflightRpcOutcome {
  if (code?.trim() === '57014') return 'database-timeout';
  if (reason === 'timeout') return 'client-timeout';
  if (reason === 'fetch-error') return 'fetch-error';
  return 'rpc-error';
}

export function boundedStorefrontPreflightRpcErrorDetail(
  code: string,
  message: string
): string | undefined {
  return `${code} ${message}`.trim().slice(0, 160) || undefined;
}

export function getStorefrontPreflightRpcThrownErrorDetail(
  error: unknown
): string | undefined {
  if (error instanceof Error || error instanceof DOMException) {
    return boundedStorefrontPreflightRpcErrorDetail(error.name, error.message);
  }
  return undefined;
}
