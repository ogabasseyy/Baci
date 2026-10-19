import { describe, expect, it } from 'vitest';
import { createAdsOAuthState, verifyAdsOAuthState } from './state';

describe('ads OAuth state', () => {
  const now = Date.parse('2026-08-21T10:00:00.000Z');
  const redirectUri = 'https://usebaci.com/api/integrations/ads/meta/callback';

  it('binds a signed state to its provider, merchant, user, and callback', () => {
    const state = createAdsOAuthState(
      {
        merchantId: 'merchant-1',
        nonce: 'nonce',
        provider: 'meta_ads',
        redirectUri,
        userId: 'user-1',
      },
      'state-secret',
      now
    );

    expect(
      verifyAdsOAuthState(
        state,
        'state-secret',
        {
          merchantId: 'merchant-1',
          provider: 'meta_ads',
          redirectUri,
          userId: 'user-1',
        },
        now
      )
    ).toMatchObject({ provider: 'meta_ads', userId: 'user-1' });
    expect(
      verifyAdsOAuthState(
        state,
        'state-secret',
        {
          merchantId: 'merchant-1',
          provider: 'tiktok_ads',
          redirectUri,
          userId: 'user-1',
        },
        now
      )
    ).toBeNull();
  });

  it('rejects expired state and a changed callback URI', () => {
    const state = createAdsOAuthState(
      {
        merchantId: 'merchant-1',
        nonce: 'nonce',
        provider: 'meta_ads',
        redirectUri,
        userId: 'user-1',
      },
      'state-secret',
      now
    );

    expect(
      verifyAdsOAuthState(
        state,
        'state-secret',
        {
          merchantId: 'merchant-1',
          provider: 'meta_ads',
          redirectUri: 'https://usebaci.com/api/integrations/ads/meta/other',
          userId: 'user-1',
        },
        now
      )
    ).toBeNull();
    expect(
      verifyAdsOAuthState(
        state,
        'state-secret',
        {
          merchantId: 'merchant-1',
          provider: 'meta_ads',
          redirectUri,
          userId: 'user-1',
        },
        now + 10 * 60 * 1000 + 1
      )
    ).toBeNull();
  });
});
