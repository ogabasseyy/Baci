import { describe, expect, it, vi } from 'vitest';
import {
  buildGoogleAdsAuthorizationUrl,
  createGoogleAdsOAuthState,
  createGoogleAdsPkcePair,
  exchangeGoogleAdsAuthorizationCode,
  parseGoogleAdsSpendRows,
  verifyGoogleAdsOAuthState,
} from './oauth';

const config = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://usebaci.com/api/integrations/ads/google/callback',
};

describe('Google Ads OAuth helpers', () => {
  it('creates and verifies a merchant-bound, expiring state', () => {
    const now = Date.parse('2026-08-21T10:00:00.000Z');
    const state = createGoogleAdsOAuthState(
      { merchantId: 'merchant-1', nonce: 'nonce', userId: 'user-1' },
      'state-secret',
      now
    );

    expect(verifyGoogleAdsOAuthState(state, 'state-secret', now)).toMatchObject(
      {
        merchantId: 'merchant-1',
        userId: 'user-1',
      }
    );
    expect(verifyGoogleAdsOAuthState(state, 'wrong-secret', now)).toBeNull();
    expect(
      verifyGoogleAdsOAuthState(state, 'state-secret', now + 11 * 60 * 1000)
    ).toBeNull();
  });

  it('builds an offline Google Ads authorization URL with PKCE', () => {
    const pkce = createGoogleAdsPkcePair();
    const url = new URL(
      buildGoogleAdsAuthorizationUrl(config, 'signed-state', pkce)
    );

    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('signed-state');
  });

  it('exchanges a code and rejects malformed provider responses', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ access_token: 'access', expires_in: 3600 }),
          { status: 200 }
        )
      );

    await expect(
      exchangeGoogleAdsAuthorizationCode(
        { ...config, code: 'code', codeVerifier: 'verifier' },
        fetchImpl
      )
    ).resolves.toMatchObject({ access_token: 'access' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({ method: 'POST' })
    );

    fetchImpl.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await expect(
      exchangeGoogleAdsAuthorizationCode(
        { ...config, code: 'code', codeVerifier: 'verifier' },
        fetchImpl
      )
    ).rejects.toMatchObject({ code: 'GOOGLE_ADS_TOKEN_RESPONSE_INVALID' });
  });
});

describe('parseGoogleAdsSpendRows', () => {
  it('parses valid searchStream batches', () => {
    expect(
      parseGoogleAdsSpendRows([
        {
          results: [
            {
              customer: { currencyCode: 'NGN', id: '1234567890' },
              metrics: {
                clicks: '4',
                conversions: '1.5',
                costMicros: '1250000',
                impressions: '100',
              },
              segments: { date: '2026-08-20' },
            },
          ],
        },
      ])
    ).toEqual([
      {
        clicks: 4,
        conversions: 1.5,
        customerId: '1234567890',
        currencyCode: 'NGN',
        date: '2026-08-20',
        impressions: 100,
        spendMicros: '1250000',
      },
    ]);
  });

  it('rejects a nonempty response when any row is malformed', () => {
    expect(() =>
      parseGoogleAdsSpendRows([
        {
          results: [
            {
              customer: { currencyCode: 'NGN', id: '1234567890' },
              metrics: {
                clicks: '4',
                conversions: '1.5',
                costMicros: '1250000',
                impressions: '100',
              },
              segments: { date: '2026-08-20' },
            },
            { metrics: { costMicros: '999' }, segments: { date: 'invalid' } },
          ],
        },
      ])
    ).toThrowError('GOOGLE_ADS_SPEND_RESPONSE_INVALID');
  });

  it('accepts an empty searchStream response', () => {
    expect(parseGoogleAdsSpendRows([])).toEqual([]);
  });

  it('preserves large cost micros strings without lossy number conversion', () => {
    const rows = parseGoogleAdsSpendRows([
      {
        results: [
          {
            customer: { currencyCode: 'NGN', id: '1234567890' },
            metrics: {
              clicks: '1',
              conversions: '0',
              costMicros: '9007199254740993',
              impressions: '10',
            },
            segments: { date: '2026-08-20' },
          },
        ],
      },
    ]);

    expect(rows[0]?.spendMicros).toBe('9007199254740993');
  });
});
