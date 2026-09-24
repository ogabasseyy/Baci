import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { JumiaApiError } from '@/lib/jumia/jumia-api-error';

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

export async function loadJumiaAuthorizationGrant(
  supabase: SupabaseClient,
  authorizationId: string,
  merchantId: string
): Promise<JumiaAuthorizationGrantRow> {
  // User-facing routes pass their authenticated client so the SECURITY
  // DEFINER RPC can enforce the merchant/staff permission checks. Worker
  // callers must pass the restricted credential client built by
  // createJumiaCredentialServiceClient, never the generic service client.
  const credentialClient = supabase as unknown as JumiaCredentialRpcClient;
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
