import type { SupabaseClient } from '@supabase/supabase-js';
import { getJumiaAuthorizationEncryptionKey } from '@/env';
import { jumiaAuthorizationCrypto } from '@/lib/jumia/authorization-crypto';
import { JumiaApiError } from '@/lib/jumia/helpers';
import { loadJumiaAuthorizationGrant } from '@/lib/jumia/load-jumia-authorization-grant';
import type { JumiaCredentialServiceClient } from '@/lib/supabase/service';

const INTEGRATION_COLUMNS =
  'id, merchant_id, shop_id, country_code, marketplace_key, access_token, refresh_token, token_expires_at, connection_method, jumia_authorization_id' as const;

type JumiaIntegrationRow = {
  id: string;
  merchant_id: string;
  shop_id: string | null;
  country_code: string | null;
  marketplace_key: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  refresh_token_expires_at?: string | null;
  connection_method: string | null;
  jumia_authorization_id: string | null;
};

export type JumiaClientConfig = {
  integrationId: string;
  merchantId: string;
  shopId: string;
  countryCode: string | null;
  marketplaceKey: string;
  accessToken: string | null;
  refreshToken: string;
  clientId?: string;
  authorizationId?: string;
  authorizationRotationVersion?: number;
  tokenExpiresAt: Date | null;
  refreshTokenExpiresAt?: Date | null;
  supabase: SupabaseClient;
};

async function toJumiaClientConfig(
  row: JumiaIntegrationRow,
  supabase: SupabaseClient,
  credentialClient?: JumiaCredentialServiceClient
): Promise<JumiaClientConfig> {
  let refreshToken = row.refresh_token || '';
  let accessToken = row.access_token;
  let clientId: string | undefined;
  let tokenExpiresAt = row.token_expires_at;
  let refreshTokenExpiresAt: string | null | undefined = null;
  let authorizationRotationVersion: number | undefined;
  if (
    row.connection_method === 'self_authorization' &&
    row.jumia_authorization_id
  ) {
    const key = getJumiaAuthorizationEncryptionKey();
    if (!key)
      throw new JumiaApiError(
        500,
        'Jumia authorization encryption is not configured'
      );
    const authorization = await loadJumiaAuthorizationGrant(
      credentialClient ?? supabase,
      row.jumia_authorization_id,
      row.merchant_id
    );
    const credentials = jumiaAuthorizationCrypto.decrypt(
      authorization.credential_ciphertext,
      key,
      jumiaAuthorizationCrypto.buildAuthorizationContext(
        row.merchant_id,
        authorization.client_key_hash
      )
    );
    refreshToken = credentials.refreshToken;
    accessToken = credentials.accessToken;
    clientId = credentials.clientId;
    tokenExpiresAt = authorization.token_expires_at;
    refreshTokenExpiresAt = authorization.refresh_token_expires_at;
    authorizationRotationVersion = authorization.rotation_version;
  }
  return {
    integrationId: row.id,
    merchantId: row.merchant_id,
    shopId: row.shop_id || 'oauth',
    countryCode: row.country_code,
    marketplaceKey: row.marketplace_key,
    accessToken,
    refreshToken,
    clientId,
    authorizationId: row.jumia_authorization_id ?? undefined,
    authorizationRotationVersion,
    tokenExpiresAt: tokenExpiresAt ? new Date(tokenExpiresAt) : null,
    refreshTokenExpiresAt: refreshTokenExpiresAt
      ? new Date(refreshTokenExpiresAt)
      : null,
    supabase,
  };
}

export async function loadJumiaIntegrationConfig(
  supabase: SupabaseClient,
  merchantId: string,
  integrationId: string,
  options?: { credentialClient?: JumiaCredentialServiceClient }
): Promise<JumiaClientConfig> {
  const { data, error } = await supabase
    .from('marketplace_integrations')
    .select(INTEGRATION_COLUMNS)
    .eq('id', integrationId)
    .eq('merchant_id', merchantId)
    .eq('platform', 'jumia')
    .eq('is_active', true)
    .single();

  if (error || !data) {
    throw new JumiaApiError(
      404,
      `Jumia integration not found: ${integrationId}`
    );
  }

  return toJumiaClientConfig(
    data as JumiaIntegrationRow,
    supabase,
    options?.credentialClient
  );
}

export async function loadSingleJumiaMerchantIntegrationConfig(
  supabase: SupabaseClient,
  merchantId: string
): Promise<JumiaClientConfig> {
  const { data, error } = await supabase
    .from('marketplace_integrations')
    .select(INTEGRATION_COLUMNS)
    .eq('merchant_id', merchantId)
    .eq('platform', 'jumia')
    .eq('is_active', true)
    .limit(2);

  if (error || !data || data.length === 0) {
    throw new JumiaApiError(404, 'No active Jumia integration found');
  }

  if (data.length > 1) {
    throw new JumiaApiError(
      400,
      `Multiple active Jumia integrations found for merchant ${merchantId}. Use forIntegration() with a specific integrationId.`
    );
  }

  return toJumiaClientConfig(data[0] as JumiaIntegrationRow, supabase);
}
