import 'server-only';

import {
  createServiceClient,
  type ReceiptLoginHintServiceClient,
} from '@/lib/supabase/service';

/**
 * Creates the server-only Supabase client for the receipt-claim
 * login-hint RPC.
 *
 * The hint function is service_role-only (the raw recipient address must
 * never be reachable from PostgREST), so the token-scoped login-email
 * route resolves through this branded client. The factory's dedicated
 * sentinel keeps this capability separate from the generic service-role
 * client and every other worker brand. Callers mask the raw address
 * before responding (see `loadReceiptClaimLoginEmailHint`).
 */
const LOGIN_HINT_RPC_NAME = 'get_receipt_claim_login_hint';

/**
 * Minimal rpc surface the login-hint edge needs. Structural (not
 * Database-typed) so the call site compiles without waiting on generated
 * types, while the facade below still constructs the branded client.
 */
export type ReceiptLoginHintRpcClient = {
  rpc: (
    fn: 'get_receipt_claim_login_hint',
    args: { p_token_hash: string }
  ) => Promise<{
    data: unknown;
    error: { code?: string | null; message?: string | null } | null;
  }>;
};

export function createReceiptLoginHintServiceClient(): ReceiptLoginHintRpcClient {
  // Defence in depth: this handle exposes exactly one RPC, not the full
  // service-role surface. Table reads (`.from`) are structurally absent
  // and any other function name throws — the branded client inside
  // constrains use at compile time, this facade constrains it at runtime.
  const client: ReceiptLoginHintServiceClient =
    createServiceClient('receipt-login-hint');
  return {
    rpc: ((functionName: string, params?: Record<string, unknown>) => {
      if (functionName !== LOGIN_HINT_RPC_NAME) {
        throw new Error(
          `receipt-login-hint handle refuses RPC '${functionName}'`
        );
      }
      // TS2589 is inference noise, not a type error: resolving the
      // overloaded PostgREST rpc signature for a plain string exceeds the
      // instantiation depth. The runtime shape is pinned by unit test
      // (`exposes only the RPC surface at runtime`, `refuses other RPCs`).
      // The double cast is intentional: the branded overload set and the
      // structural single-RPC surface do not overlap enough for a direct
      // cast (same situation as the Jumia credential RPC client).
      // @ts-expect-error overloaded rpc resolution is intentionally unchecked here
      return client.rpc(functionName, params);
    }) as unknown as ReceiptLoginHintRpcClient['rpc'],
  };
}

export type { ReceiptLoginHintServiceClient } from '@/lib/supabase/service';
