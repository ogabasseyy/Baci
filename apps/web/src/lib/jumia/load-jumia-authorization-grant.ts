import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { hasPermission } from '@/lib/api-permissions';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { JumiaApiError } from '@/lib/jumia/jumia-api-error';
import { createJumiaCredentialLoaderClient } from '@/lib/jumia/jumia-credential-loader-client';

type JumiaCredentialRpcClient = {
  rpc: (
    functionName: 'load_jumia_authorization_credentials',
    args: { p_authorization_id: string; p_merchant_id: string }
  ) => Promise<{
    data: unknown;
    error: { code?: string | null; message: string } | null;
  }>;
};

type JumiaAuthorizationGrantRow = {
  credential_ciphertext: string;
  token_expires_at: string;
  refresh_token_expires_at: string;
  rotation_version: number;
  client_key_hash: string;
};

/**
 * Resolves the narrow capability client for the credential RPC after
 * enforcing the owner/manage check up front (fail fast). The RPC
 * re-verifies the minted user/merchant claims and the permission rule in
 * the database, so no service-role elevation enters user-facing graphs.
 * Throws 403 when the caller is not authorized for this merchant.
 */
async function authorizedCredentialClient(
  supabase: SupabaseClient,
  userId: string,
  merchantId: string
): Promise<SupabaseClient> {
  const merchantContext = await getMerchantForApiRequest(supabase, userId, {
    requestedMerchantId: merchantId,
  });
  if (
    !merchantContext ||
    merchantContext.merchantId !== merchantId ||
    !hasPermission(toUserAccess(merchantContext), 'integrations', 'manage')
  ) {
    throw new JumiaApiError(403, 'Jumia authorization grant access denied');
  }
  return createJumiaCredentialLoaderClient(userId, merchantId);
}

export async function loadJumiaAuthorizationGrant(
  supabase: SupabaseClient,
  authorizationId: string,
  merchantId: string
): Promise<JumiaAuthorizationGrantRow> {
  // The grant RPC is executable by the service role (workers) and the
  // narrow jumia_credential_loader capability role only: browser clients
  // must never invoke it directly, even with a manage-authorized JWT.
  // User-facing callers pass their requester client; the owner/manage
  // check runs here before a short-lived capability JWT executes the call.
  // Privileged callers (workers) pass a sessionless credential client,
  // which is used as-is — anything else fails closed with 42501.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const rpcClient = user
    ? await authorizedCredentialClient(supabase, user.id, merchantId)
    : supabase;
  const credentialClient = rpcClient as unknown as JumiaCredentialRpcClient;
  const { data, error } = await credentialClient.rpc(
    'load_jumia_authorization_credentials',
    {
      p_authorization_id: authorizationId,
      p_merchant_id: merchantId,
    }
  );

  if (error) {
    const code = typeof error.code === 'string' ? error.code : '';
    const status = code === '42501' ? 403 : 503;
    throw new JumiaApiError(
      status,
      status === 403
        ? 'Jumia authorization grant access denied'
        : 'Jumia authorization grant is temporarily unavailable',
      error
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (
    !row ||
    typeof row !== 'object' ||
    !('credential_ciphertext' in row) ||
    typeof row.credential_ciphertext !== 'string' ||
    !('token_expires_at' in row) ||
    typeof row.token_expires_at !== 'string' ||
    !('refresh_token_expires_at' in row) ||
    typeof row.refresh_token_expires_at !== 'string' ||
    !('rotation_version' in row) ||
    typeof row.rotation_version !== 'number' ||
    !('client_key_hash' in row) ||
    typeof row.client_key_hash !== 'string'
  ) {
    throw new JumiaApiError(404, 'Jumia authorization grant not found');
  }

  return row as JumiaAuthorizationGrantRow;
}
