import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

type JumiaAuthorizationMetadata = {
  id: string;
  token_expires_at: string;
  refresh_token_expires_at: string | null;
  rotation_version: number;
};

function isMetadataRow(value: unknown): value is JumiaAuthorizationMetadata {
  if (!value || typeof value !== 'object') return false;
  if (!('id' in value) || typeof value.id !== 'string') return false;
  if (
    !('token_expires_at' in value) ||
    typeof value.token_expires_at !== 'string'
  ) {
    return false;
  }
  if (
    !('refresh_token_expires_at' in value) ||
    (value.refresh_token_expires_at !== null &&
      typeof value.refresh_token_expires_at !== 'string')
  ) {
    return false;
  }
  return (
    'rotation_version' in value && typeof value.rotation_version === 'number'
  );
}

export async function findJumiaAuthorizationMetadata(args: {
  clientKeyHash: string;
  merchantId: string;
  supabase: SupabaseClient;
}): Promise<JumiaAuthorizationMetadata[]> {
  const { data, error } = await args.supabase.rpc(
    'find_jumia_authorization_metadata',
    {
      p_merchant_id: args.merchantId,
      p_client_key_hash: args.clientKeyHash,
    }
  );

  if (error) {
    throw new Error('Failed to load existing Jumia authorization');
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return rows.filter(isMetadataRow);
}
