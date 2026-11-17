import { describe, expect, it, vi } from 'vitest';
import {
  extractStorefrontOAuthCallbackNext,
  resolveTrustedStorefrontRedirectUrl,
} from './oauth-redirect';

vi.mock('@/env', () => ({
  getAppUrl: () => 'https://usebaci.com',
  getRootDomain: () => 'usebaci.com',
}));

const merchant = {
  custom_domain: 'ogabassey.com',
  slug: 'ogabassey',
};

describe('resolveTrustedStorefrontRedirectUrl', () => {
  it('defaults to the app account URL when no redirect is supplied', () => {
    expect(resolveTrustedStorefrontRedirectUrl(undefined, merchant)).toBe(
      'https://usebaci.com/account'
    );
  });

  it('normalizes relative redirects against the app origin', () => {
    expect(
      resolveTrustedStorefrontRedirectUrl(
        '/account/callback?tab=orders',
        merchant
      )
    ).toBe('https://usebaci.com/account/callback?tab=orders');
  });

  it('allows the merchant subdomain origin', () => {
    expect(
      resolveTrustedStorefrontRedirectUrl(
        'https://ogabassey.usebaci.com/account/callback',
        merchant
      )
    ).toBe('https://ogabassey.usebaci.com/account/callback');
  });

  it('allows the merchant configured custom-domain origin and its www variant', () => {
    expect(
      resolveTrustedStorefrontRedirectUrl(
        'https://ogabassey.com/account/callback',
        merchant
      )
    ).toBe('https://ogabassey.com/account/callback');
    expect(
      resolveTrustedStorefrontRedirectUrl(
        'https://www.ogabassey.com/account/callback',
        merchant
      )
    ).toBe('https://www.ogabassey.com/account/callback');
  });

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

  it('rejects unrelated absolute origins', () => {
    expect(
      resolveTrustedStorefrontRedirectUrl(
        'https://evil.example/account/callback',
        merchant
      )
    ).toBeNull();
  });

  it('ignores malformed configured custom domains', () => {
    expect(
      resolveTrustedStorefrontRedirectUrl(
        'https://ogabassey.com/account/callback',
        { custom_domain: 'ogabassey.com/path', slug: 'ogabassey' }
      )
    ).toBeNull();
  });

  it('re-points a retired-subdomain redirect to the canonical custom domain', () => {
    // Customer tab still open on old.usebaci.com after the store renamed old -> ogabassey.
    // The request presents the retired slug ('old'); the redirect must survive by
    // moving onto the merchant's canonical origin, preserving path + query.
    expect(
      resolveTrustedStorefrontRedirectUrl(
        'https://old.usebaci.com/account/callback?next=%2Forders',
        merchant,
        'old'
      )
    ).toBe('https://ogabassey.com/account/callback?next=%2Forders');
  });

  it('re-points a retired-subdomain redirect to the canonical subdomain when no custom domain', () => {
    expect(
      resolveTrustedStorefrontRedirectUrl(
        'https://old.usebaci.com/account/callback',
        { custom_domain: null, slug: 'ogabassey' },
        'old'
      )
    ).toBe('https://ogabassey.usebaci.com/account/callback');
  });

  it('still rejects an unrelated origin even with a requested identifier', () => {
    // The retired-alias rewrite only applies to the retired slug's OWN subdomain
    // origin — an arbitrary origin is never trusted just because an identifier is present.
    expect(
      resolveTrustedStorefrontRedirectUrl(
        'https://evil.example/account/callback',
        merchant,
        'old'
      )
    ).toBeNull();
  });
});
