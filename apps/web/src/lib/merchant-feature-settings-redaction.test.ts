import { describe, expect, it } from 'vitest';
import {
  preserveZohoCampaignSecretCustomSettings,
  redactMerchantFeatureSettingsResponse,
} from './merchant-feature-settings-redaction';

describe('merchant feature settings redaction', () => {
  it('redacts Zoho Campaigns secret fields from feature settings responses', () => {
    const response = redactMerchantFeatureSettingsResponse({
      id: 'settings-1',
      custom_settings: {
        theme: 'compact',
        zohoCampaigns: {
          apiDomain: 'https://campaigns.zoho.eu',
          enabled: true,
          refreshToken: 'secret-refresh-token',
        },
        zoho_campaigns: {
          access_token: 'secret-access-token',
          client_secret: 'secret-client',
          list_key: 'list-key',
          refresh_token: 'secret-refresh-token-2',
        },
      },
    });

    expect(response.custom_settings).toEqual({
      theme: 'compact',
      zohoCampaigns: {
        apiDomain: 'https://campaigns.zoho.eu',
        enabled: true,
      },
      zoho_campaigns: {
        list_key: 'list-key',
      },
    });
  });

  it('preserves stored Zoho Campaigns secrets when unrelated custom settings are written', () => {
    expect(
      preserveZohoCampaignSecretCustomSettings(
        { integrationCardsCollapsed: true },
        {
          zohoCampaigns: {
            enabled: true,
            refreshToken: 'secret-refresh-token',
          },
        }
      )
    ).toEqual({
      integrationCardsCollapsed: true,
      zohoCampaigns: {
        enabled: true,
        refreshToken: 'secret-refresh-token',
      },
    });
  });

  it('preserves existing Zoho fields when partial Zoho settings are updated', () => {
    expect(
      preserveZohoCampaignSecretCustomSettings(
        {
          zohoCampaigns: {
            apiDomain: 'https://campaigns.zoho.in',
            enabled: false,
          },
        },
        {
          zohoCampaigns: {
            enabled: true,
            listKey: 'list-key',
            refreshToken: 'secret-refresh-token',
          },
        }
      )
    ).toEqual({
      zohoCampaigns: {
        apiDomain: 'https://campaigns.zoho.in',
        enabled: false,
        listKey: 'list-key',
        refreshToken: 'secret-refresh-token',
      },
    });
  });

  it('allows explicit Zoho secret rotation', () => {
    expect(
      preserveZohoCampaignSecretCustomSettings(
        {
          zohoCampaigns: {
            refreshToken: 'rotated-refresh-token',
          },
        },
        {
          zohoCampaigns: {
            refreshToken: 'old-refresh-token',
          },
        }
      )
    ).toEqual({
      zohoCampaigns: {
        refreshToken: 'rotated-refresh-token',
      },
    });
  });
});

it.each([
  undefined,
  {},
])('redacts all ad secrets even without custom_settings %j', (custom_settings) => {
  const secrets = {
    facebook_capi_token: 'fb-secret',
    tiktok_access_token: 'tt-secret',
    snapchat_capi_token: 'snap-secret',
    ga4_api_secret: 'ga-secret',
  };
  const safe = redactMerchantFeatureSettingsResponse({
    ...secrets,
    custom_settings,
    reviews_enabled: true,
  }) as Record<string, unknown>;
  expect(JSON.stringify(safe)).not.toMatch(
    /fb-secret|tt-secret|snap-secret|ga-secret/
  );
  for (const key of Object.keys(secrets)) {
    expect(safe[key]).toBeNull();
    expect(safe[`${key}_configured`]).toBe(true);
  }
  expect(safe.reviews_enabled).toBe(true);
});
