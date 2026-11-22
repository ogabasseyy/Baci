import { describe, expect, it, vi } from 'vitest';
import {
  STOREFRONT_OAUTH_NEXT_COOKIE,
  syncStorefrontOAuthNextCookie,
} from './oauth-next-cookie';

describe('syncStorefrontOAuthNextCookie', () => {
  it('sets the httpOnly cookie when nextTarget is present and deletes it when absent', () => {
    const set = vi.fn();
    const del = vi.fn();

    syncStorefrontOAuthNextCookie({ set, delete: del }, '/checkout');
    expect(set).toHaveBeenCalledWith(
      STOREFRONT_OAUTH_NEXT_COOKIE,
      '/checkout',
      expect.objectContaining({
        httpOnly: true,
        maxAge: 600,
        path: '/',
        sameSite: 'lax',
      })
    );

    syncStorefrontOAuthNextCookie({ set, delete: del }, null);
    expect(del).toHaveBeenCalledWith(STOREFRONT_OAUTH_NEXT_COOKIE);
  });
});
