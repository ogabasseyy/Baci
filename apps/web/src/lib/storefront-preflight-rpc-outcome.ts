import type { StorefrontPreflightRpcOutcome } from './storefront-preflight-rpc-attempt';

export function classifyStorefrontPreflightRpcOutcome(
  reason: 'timeout' | 'fetch-error' | 'has-error',
  code?: string
): StorefrontPreflightRpcOutcome {
  if (code?.trim() === '57014') return 'database-timeout';
  if (reason === 'timeout') return 'client-timeout';
  if (reason === 'fetch-error') return 'fetch-error';
  return 'rpc-error';
}
