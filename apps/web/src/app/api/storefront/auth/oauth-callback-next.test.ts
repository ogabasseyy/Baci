import { describe, expect, it } from 'vitest';
import { extractStorefrontOAuthCallbackNext } from './oauth-callback-next';

describe('extractStorefrontOAuthCallbackNext', () => {
  it('extracts ?next= from /account/callback so Supabase receives an exact callback URL', () => {
    expect(
      extractStorefrontOAuthCallbackNext(
        'https://ogabassey.com/account/callback?next=%2Fcheckout'
      )
    ).toEqual({
      redirectTo: 'https://ogabassey.com/account/callback',
      nextTarget: '/checkout',
    });
  });

  it('strips all query parameters from /account/callback when extracting nextTarget', () => {
    expect(
      extractStorefrontOAuthCallbackNext(
        'https://ogabassey.com/account/callback?next=%2Fcheckout&source=banner'
      )
    ).toEqual({
      redirectTo: 'https://ogabassey.com/account/callback',
      nextTarget: '/checkout',
    });
  });

  it('validates ?next= against expectedMerchantSlug when supplied', () => {
    expect(
      extractStorefrontOAuthCallbackNext(
        'https://usebaci.com/ogabassey/account/callback?next=%2Fogabassey%2Fcheckout',
        'ogabassey'
      )
    ).toEqual({
      redirectTo: 'https://usebaci.com/ogabassey/account/callback',
      nextTarget: '/ogabassey/checkout',
    });

    // Mismatched merchant slug is dropped from nextTarget
    expect(
      extractStorefrontOAuthCallbackNext(
        'https://usebaci.com/ogabassey/account/callback?next=%2Fotherstore%2Fcheckout',
        'ogabassey'
      )
    ).toEqual({
      redirectTo: 'https://usebaci.com/ogabassey/account/callback',
      nextTarget: null,
    });
  });

  it('returns the original URL unchanged when next is absent or path is not callback', () => {
    expect(
      extractStorefrontOAuthCallbackNext('https://ogabassey.com/account')
    ).toEqual({
      redirectTo: 'https://ogabassey.com/account',
      nextTarget: null,
    });
  });
});
