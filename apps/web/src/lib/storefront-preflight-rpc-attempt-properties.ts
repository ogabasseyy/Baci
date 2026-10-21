import type { StorefrontPreflightRpcAttemptProperties } from './storefront-preflight-rpc-attempt';

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
