import type { SupabaseClient } from '@supabase/supabase-js';
import { persistJumiaOAuthIntegrations } from '@/lib/jumia/persist-jumia-oauth-integrations';

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

export async function persistJumiaOAuthExchangeIntegrations(args: {
  supabase: Pick<SupabaseClient, 'rpc'>;
  integrationRows: JumiaOAuthIntegrationRow[];
}): Promise<{ ok: true } | { ok: false; error: unknown }> {
  return await persistJumiaOAuthIntegrations(
    args.supabase,
    args.integrationRows
  );
}
