export const JUMIA_INTEGRATION_COLUMNS =
  'id, merchant_id, shop_id, marketplace_key, access_token, refresh_token, token_expires_at, last_sync_at, sync_config';

export interface JumiaOrderSyncIntegration {
  id: string;
  merchant_id: string;
  shop_id: string;
  marketplace_key: string | null;
  access_token: string | null;
  refresh_token: string;
  token_expires_at: string | null;
  last_sync_at: string | null;
  sync_config: {
    stock?: boolean;
    products?: boolean;
    orders?: boolean;
  } | null;
}

type IntegrationQuery = {
  select(columns: string): IntegrationQuery;
  eq(column: string, value: unknown): IntegrationQuery;
  neq(
    column: string,
    value: unknown
  ): Promise<{
    data: unknown[] | null;
    error: { message: string } | null;
  }>;
};

type SupabaseIntegrationClient = {
  from(table: string): IntegrationQuery;
};

/** Load active OAuth integrations owned by the legacy edge worker. */
export async function loadJumiaOrderSyncIntegrations(
  supabase: SupabaseIntegrationClient
): Promise<JumiaOrderSyncIntegration[]> {
  const { data, error } = await supabase
    .from('marketplace_integrations')
    .select(JUMIA_INTEGRATION_COLUMNS)
    .eq('platform', 'jumia')
    .eq('is_active', true)
    .neq('connection_method', 'self_authorization');

  if (error) {
    throw new Error(`Database error: ${error.message}`);
  }

  return (data ?? []) as JumiaOrderSyncIntegration[];
}
