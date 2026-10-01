import { describe, expect, it } from 'vitest';
import { resolveTikTokAdsAccessToken } from './access-token';

describe('TikTok Ads token', () => {
  it('requires an encrypted long-term token', () =>
    expect(() =>
      resolveTikTokAdsAccessToken(
        { access_token_ciphertext: null },
        {} as never
      )
    ).toThrow('REAUTH'));
});
