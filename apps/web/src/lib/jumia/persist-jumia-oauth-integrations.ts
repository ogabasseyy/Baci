import type { SupabaseClient } from '@supabase/supabase-js';

const JUMIA_OAUTH_PERSIST_ATTEMPTS = 3;

type JumiaOAuthIntegrationRow = {
  merchant_id: string;
  platform: 'jumia';
  shop_id: string;
  marketplace_key: string;
  connection_method: 'oauth';
  shop_name: string;
  country_code: string;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: string;
  is_active: boolean;
  jumia_authorization_id: null;
  sync_config: Record<string, unknown>;
};

export async function persistJumiaOAuthIntegrations(
  supabase: Pick<SupabaseClient, 'rpc'>,
  integrationRows: JumiaOAuthIntegrationRow[]
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  const merchantId = integrationRows[0]?.merchant_id;
  if (!merchantId) {
    return { ok: false, error: new Error('No Jumia integrations to persist') };
  }

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= JUMIA_OAUTH_PERSIST_ATTEMPTS; attempt += 1) {
    const { data, error } = await supabase.rpc(
      'persist_jumia_oauth_integrations_atomically',
      {
        p_merchant_id: merchantId,
        p_integrations: integrationRows,
      }
    );
    if (!error && data === true) {
      return { ok: true };
    }

    lastError = error ?? new Error('Jumia OAuth persistence was not confirmed');
  }

  return { ok: false, error: lastError };
}
