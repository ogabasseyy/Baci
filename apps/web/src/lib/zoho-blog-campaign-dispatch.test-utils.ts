import type { SupabaseClient } from '@supabase/supabase-js';
import type { ZohoCampaignsRuntimeConfig } from '@/env';

export const baseConfig: ZohoCampaignsRuntimeConfig = {
  accountsServerUrl: 'https://accounts.zoho.com',
  apiRootUrl: 'https://campaigns.zoho.com/api/v1.1',
  autoSend: true,
  clientId: 'client-id',
  clientSecret: 'client-secret',
  enabled: true,
  fromEmail: 'news@ogabassey.com',
  fromName: 'OgaBassey',
  contentSecret: 'content-secret',
  listKey: 'list-key',
  publicBaseUrl: 'https://ogabassey.com',
  redirectUri: 'https://ogabassey.com/api/integrations/zoho/callback',
  refreshToken: 'refresh-token',
  requestTimeoutMs: 15_000,
};

export const post = {
  id: '4db63f48-3577-4ef3-9e09-e3ec6af7a5a2',
  merchant_id: 'merchant-1',
  slug: 'infinix-hot-70-launch',
  title: 'Infinix Hot 70 released',
};

export const context = {
  canonicalMerchantSlug: 'ogabassey',
  identifiers: ['ogabassey', 'ogabassey.com'],
};

const merchantZohoSettings = {
  zohoCampaigns: {
    enabled: true,
    fromEmail: 'news@merchant.test',
    listKey: 'merchant-list-key',
    reviewListKey: 'merchant-review-list-key',
  },
};

// The refresh token is stored apart from custom_settings (read via RPC).
const merchantRefreshToken = 'merchant-refresh-token';

export function createDispatchSupabaseMock({
  customSettings = merchantZohoSettings,
  businessName = 'Oga Gadgets',
  refreshToken = merchantRefreshToken,
}: {
  customSettings?: unknown;
  businessName?: string;
  refreshToken?: string | null;
} = {}) {
  // Supports the dispatch query shape: from(table).select().eq().maybeSingle().
  // merchant_feature_settings returns custom_settings; other tables return brand data.
  return {
    rpc: () => ({ data: refreshToken, error: null }),
    from(table: string) {
      const maybeSingle = () =>
        table === 'merchant_feature_settings'
          ? { data: { custom_settings: customSettings }, error: null }
          : {
              data: {
                brand_colors: { primary: '#dc2626' },
                business_name: businessName,
              },
              error: null,
            };
      return { select: () => ({ eq: () => ({ maybeSingle }) }) };
    },
  } as unknown as SupabaseClient;
}
