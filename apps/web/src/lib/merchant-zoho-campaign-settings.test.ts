import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { ZohoCampaignsRuntimeConfig } from '@/env';
import {
  getMerchantZohoEmailBrand,
  normalizeZohoBrandColor,
  parseMerchantZohoCampaignSettings,
  resolveMerchantZohoCampaignConfig,
} from './merchant-zoho-campaign-settings';

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
  brandColors = { primary: '#dc2626' },
  businessName = 'Merchant Store',
  customSettings,
  refreshToken = null,
  settingsError = null,
  tokenError = null,
}: {
  brandColors?: unknown;
  businessName?: string | null;
  customSettings?: unknown;
  refreshToken?: string | null;
  settingsError?: { message: string } | null;
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
                  if (table === 'merchant_feature_settings') {
                    return settingsError
                      ? { data: null, error: settingsError }
                      : {
                          data: { custom_settings: customSettings ?? null },
                          error: null,
                        };
                  }

                  return {
                    data: {
                      brand_colors: brandColors,
                      business_name: businessName,
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

describe('merchant Zoho Campaigns settings', () => {
  it('parses camelCase and snake_case Zoho settings from custom_settings', () => {
    expect(
      parseMerchantZohoCampaignSettings({
        zoho_campaigns: {
          api_domain: 'https://campaigns.zoho.eu',
          auto_send: 'true',
          enabled: true,
          from_email: 'news@example.com',
          from_name: 'Example News',
          list_key: 'list-1',
          refresh_token: 'refresh-1',
          review_list_key: 'review-list-1',
          topic_id: 'topic-1',
        },
      })
    ).toEqual({
      accountsServerUrl: 'https://accounts.zoho.eu',
      apiRootUrl: 'https://campaigns.zoho.eu/api/v1.1',
      autoSend: true,
      enabled: true,
      fromEmail: 'news@example.com',
      fromName: 'Example News',
      listKey: 'list-1',
      refreshToken: 'refresh-1',
      reviewListKey: 'review-list-1',
      topicId: 'topic-1',
    });
  });

  it('does not use global Zoho credentials when merchant settings are missing', async () => {
    const result = await resolveMerchantZohoCampaignConfig({
      config,
      merchantId: 'merchant-1',
      supabase: createSupabaseMock({}),
    });

    expect(result).toEqual({
      reason: 'Zoho Campaigns is not enabled for this merchant',
      status: 'skipped',
    });
  });

  it('requires merchant-scoped refresh token, list key, and sender email', async () => {
    const result = await resolveMerchantZohoCampaignConfig({
      config,
      merchantId: 'merchant-1',
      supabase: createSupabaseMock({
        customSettings: { zohoCampaigns: { enabled: true } },
      }),
    });

    expect(result).toEqual({
      reason:
        'Missing Zoho Campaigns merchant settings: refreshToken, listKey, fromEmail',
      status: 'skipped',
    });
  });

  it('normalizes merchant Zoho data center settings to the Campaigns API root', async () => {
    const parsed = parseMerchantZohoCampaignSettings({
      zohoCampaigns: {
        apiDomain: 'https://www.zohoapis.in',
        enabled: true,
        fromEmail: 'support@merchant.test',
        listKey: 'merchant-list',
        refreshToken: 'merchant-refresh-token',
        reviewListKey: 'merchant-review-list',
      },
    });

    expect(parsed).toMatchObject({
      accountsServerUrl: 'https://accounts.zoho.in',
      apiRootUrl: 'https://campaigns.zoho.in/api/v1.1',
      reviewListKey: 'merchant-review-list',
    });

    const result = await resolveMerchantZohoCampaignConfig({
      config,
      merchantId: 'merchant-1',
      supabase: createSupabaseMock({
        refreshToken: 'merchant-refresh-token',
        customSettings: {
          zohoCampaigns: {
            apiRootUrl: 'https://campaigns.zoho.com.au/api/v1.1',
            enabled: true,
            fromEmail: 'support@merchant.test',
            listKey: 'merchant-list',
            refreshToken: 'merchant-refresh-token',
            reviewListKey: 'merchant-review-list',
          },
        },
      }),
    });

    expect(result).toMatchObject({
      config: {
        accountsServerUrl: 'https://accounts.zoho.com.au',
        apiRootUrl: 'https://campaigns.zoho.com.au/api/v1.1',
      },
      status: 'configured',
    });
  });

  it('ignores unsafe merchant Zoho API root settings', async () => {
    const result = await resolveMerchantZohoCampaignConfig({
      config,
      merchantId: 'merchant-1',
      supabase: createSupabaseMock({
        refreshToken: 'merchant-refresh-token',
        customSettings: {
          zohoCampaigns: {
            apiDomain: 'https://example.com',
            enabled: true,
            fromEmail: 'support@merchant.test',
            listKey: 'merchant-list',
            refreshToken: 'merchant-refresh-token',
            reviewListKey: 'merchant-review-list',
          },
        },
      }),
    });

    expect(result).toMatchObject({
      config: {
        accountsServerUrl: config.accountsServerUrl,
        apiRootUrl: config.apiRootUrl,
      },
      status: 'configured',
    });
  });

  it('overlays tenant-specific campaign settings and merchant branding', async () => {
    const result = await resolveMerchantZohoCampaignConfig({
      config,
      merchantId: 'merchant-1',
      supabase: createSupabaseMock({
        businessName: 'Oga Gadgets',
        refreshToken: 'merchant-refresh-token',
        customSettings: {
          zohoCampaigns: {
            autoSend: true,
            enabled: true,
            fromEmail: 'support@merchant.test',
            listKey: 'merchant-list',
            refreshToken: 'merchant-refresh-token',
            reviewListKey: 'merchant-review-list',
          },
        },
      }),
    });

    expect(result).toMatchObject({
      brand: { brandColor: '#dc2626', brandName: 'Oga Gadgets' },
      config: {
        autoSend: true,
        fromEmail: 'support@merchant.test',
        fromName: 'Oga Gadgets',
        listKey: 'merchant-list',
        refreshToken: 'merchant-refresh-token',
      },
      reviewListKey: 'merchant-review-list',
      status: 'configured',
    });
  });

  it('normalizes short hex colors and rejects unsafe color values', () => {
    expect(normalizeZohoBrandColor('#c00')).toBe('#cc0000');
    expect(normalizeZohoBrandColor('rgb(1,2,3)')).toBeUndefined();
    expect(normalizeZohoBrandColor('javascript:alert(1)')).toBeUndefined();
  });

  it('loads safe merchant email branding from merchant data', async () => {
    await expect(
      getMerchantZohoEmailBrand(
        createSupabaseMock({
          brandColors: { accent: '#0f0' },
          businessName: '  Merchant Updates  ',
        }),
        'merchant-1'
      )
    ).resolves.toEqual({
      brandColor: '#00ff00',
      brandName: 'Merchant Updates',
    });
  });
});
