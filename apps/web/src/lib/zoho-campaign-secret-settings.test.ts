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

  it('treats a blank or null refresh token as an explicit clear', () => {
    const blank = extractZohoCampaignSecrets({
      zohoCampaigns: { enabled: true, refreshToken: '   ' },
    });
    const nulled = extractZohoCampaignSecrets({
      zoho_campaigns: { refresh_token: null },
    });

    expect(blank.refreshToken).toBeNull();
    expect(blank.customSettings).toEqual({ zohoCampaigns: { enabled: true } });
    expect(nulled.refreshToken).toBeNull();
  });

  it('ignores a non-string token value instead of clearing the stored one', () => {
    const result = extractZohoCampaignSecrets({
      zohoCampaigns: { enabled: true, refreshToken: 42 },
    });

    expect(result.refreshToken).toBeUndefined();
    expect(result.customSettings).toEqual({ zohoCampaigns: { enabled: true } });
  });

  it('trims tabs and newlines like the database backfill does', () => {
    const result = extractZohoCampaignSecrets({
      zohoCampaigns: { refreshToken: '\t\n real \r' },
    });

    expect(result.refreshToken).toBe('real');
  });

  it('leaves the stored token alone when the request does not mention it', () => {
    const result = extractZohoCampaignSecrets({
      zohoCampaigns: { enabled: false, listKey: 'L1' },
    });

    expect(result.refreshToken).toBeUndefined();
  });

  it('prefers a real token over a blank one under the other spelling', () => {
    const result = extractZohoCampaignSecrets({
      zohoCampaigns: { refreshToken: '' },
      zoho_campaigns: { refresh_token: 'real' },
    });

    expect(result.refreshToken).toBe('real');
  });

  it('does not mutate its input and passes non-objects through', () => {
    const input = { zohoCampaigns: { refreshToken: 'r' } };
    extractZohoCampaignSecrets(input);
    expect(input.zohoCampaigns.refreshToken).toBe('r');
    expect(extractZohoCampaignSecrets(undefined)).toEqual({
      customSettings: undefined,
      refreshToken: undefined,
    });
    expect(extractZohoCampaignSecrets({}).customSettings).toEqual({});
  });
});
