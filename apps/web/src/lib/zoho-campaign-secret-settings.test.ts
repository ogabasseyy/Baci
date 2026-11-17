import { describe, expect, it } from 'vitest';
import { extractZohoCampaignSecrets } from './zoho-campaign-secret-settings';

describe('extractZohoCampaignSecrets', () => {
  it('removes every Zoho token key and returns the trimmed refresh token', () => {
    const result = extractZohoCampaignSecrets({
      theme: 'dark',
      zohoCampaigns: {
        accessToken: 'a',
        clientSecret: 'c',
        enabled: true,
        listKey: 'L1',
        refreshToken: '  r1  ',
      },
    });

    expect(result.refreshToken).toBe('r1');
    expect(result.customSettings).toEqual({
      theme: 'dark',
      zohoCampaigns: { enabled: true, listKey: 'L1' },
    });
  });

  it('handles the snake_case spelling', () => {
    const result = extractZohoCampaignSecrets({
      zoho_campaigns: {
        access_token: 'a',
        client_secret: 'c',
        from_email: 'x@y.test',
        refresh_token: 'r2',
      },
    });

    expect(result.refreshToken).toBe('r2');
    expect(result.customSettings).toEqual({
      zoho_campaigns: { from_email: 'x@y.test' },
    });
  });

  it('ignores a blank refresh token but still strips it', () => {
    const result = extractZohoCampaignSecrets({
      zohoCampaigns: { enabled: true, refreshToken: '   ' },
    });

    expect(result.refreshToken).toBeUndefined();
    expect(result.customSettings).toEqual({ zohoCampaigns: { enabled: true } });
  });

  it('does not mutate its input and passes non-objects through', () => {
    const input = { zohoCampaigns: { refreshToken: 'r' } };
    extractZohoCampaignSecrets(input);
    expect(input.zohoCampaigns.refreshToken).toBe('r');
    expect(extractZohoCampaignSecrets(undefined)).toEqual({
      customSettings: undefined,
      refreshToken: undefined,
    });
    expect(extractZohoCampaignSecrets('x').customSettings).toBe('x');
  });
});
