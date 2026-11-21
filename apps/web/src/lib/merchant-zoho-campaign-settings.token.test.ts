import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { ZohoCampaignsRuntimeConfig } from '@/env';
import { resolveMerchantZohoCampaignConfig } from './merchant-zoho-campaign-settings';

const config: ZohoCampaignsRuntimeConfig = {
  accountsServerUrl: 'https://accounts.zoho.com',
  apiRootUrl: 'https://campaigns.zoho.com/api/v1.1',
  autoSend: false,
  clientId: 'client-id',
  clientSecret: 'client-secret',
  enabled: true,
  fromEmail: 'global@example.com',
  fromName: 'Global Store',
  contentSecret: 'content-secret',
  listKey: 'global-list',
  publicBaseUrl: 'https://usebaci.com',
  redirectUri: 'https://usebaci.com/api/integrations/zoho/callback',
  refreshToken: 'global-refresh-token',
  requestTimeoutMs: 15_000,
  topicId: 'global-topic',
};

function createSupabaseMock({
  customSettings,
  refreshToken = null,
  tokenError = null,
}: {
  customSettings?: unknown;
  refreshToken?: string | null;
  tokenError?: { message: string } | null;
}) {
  return {
    rpc(name: string) {
      if (name !== 'get_merchant_zoho_refresh_token')
        throw new Error(`Unexpected rpc ${name}`);
      return tokenError
        ? { data: null, error: tokenError }
        : { data: refreshToken, error: null };
    },
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle() {
                  return table === 'merchant_feature_settings'
                    ? {
                        data: { custom_settings: customSettings ?? null },
                        error: null,
                      }
                    : {
                        data: {
                          brand_colors: { primary: '#dc2626' },
                          business_name: 'Merchant Store',
                        },
                        error: null,
                      };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe('bugfix R2: refresh token is not read from custom_settings', () => {
  const settingsWithoutToken = {
    zohoCampaigns: {
      enabled: true,
      fromEmail: 'support@merchant.test',
      listKey: 'merchant-list',
    },
  };

  it('takes the refresh token from the protected function, not custom_settings', async () => {
    const result = await resolveMerchantZohoCampaignConfig({
      config,
      merchantId: 'merchant-1',
      supabase: createSupabaseMock({
        customSettings: {
          zohoCampaigns: {
            ...settingsWithoutToken.zohoCampaigns,
            refreshToken: 'legacy-token-in-jsonb',
          },
        },
        refreshToken: 'protected-token',
      }),
    });

    expect(result).toMatchObject({
      config: { refreshToken: 'protected-token' },
      status: 'configured',
    });
  });

  it('skips sending when the protected function returns no token', async () => {
    const result = await resolveMerchantZohoCampaignConfig({
      config,
      merchantId: 'merchant-1',
      supabase: createSupabaseMock({
        customSettings: {
          zohoCampaigns: {
            ...settingsWithoutToken.zohoCampaigns,
            refreshToken: 'legacy-token-in-jsonb',
          },
        },
        refreshToken: null,
      }),
    });

    expect(result).toEqual({
      reason: 'Missing Zoho Campaigns merchant settings: refreshToken',
      status: 'skipped',
    });
  });

  it('surfaces a failure to read the token instead of sending without it', async () => {
    await expect(
      resolveMerchantZohoCampaignConfig({
        config,
        merchantId: 'merchant-1',
        supabase: createSupabaseMock({
          customSettings: settingsWithoutToken,
          tokenError: { message: 'permission denied' },
        }),
      })
    ).rejects.toMatchObject({ message: 'permission denied' });
  });
});
