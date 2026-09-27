import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { redirectForJumiaOAuthPersistence } from './oauth-persistence-redirect';

function makeRequest(): NextRequest {
  return new NextRequest(
    'http://localhost:3000/api/marketplace/jumia/callback'
  );
}

describe('redirectForJumiaOAuthPersistence', () => {
  it('redirects persistence failures to an error query', () => {
    for (const status of ['database_error', 'shop_discovery_failed'] as const) {
      const response = redirectForJumiaOAuthPersistence(makeRequest(), {
        persistence: { status },
      });

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toContain(`error=${status}`);
    }
  });

  it('redirects self-authorization conflicts with the conflicting shops', () => {
    const response = redirectForJumiaOAuthPersistence(makeRequest(), {
      persistence: {
        status: 'shop_already_self_authorized',
        shopIds: ['shop-1', 'shop-2'],
      },
    });

    expect(response.headers.get('location')).toContain(
      'error=shop_already_self_authorized&shops=shop-1%2Cshop-2'
    );
  });

  it('reports fallback-only persistence as incomplete instead of success', () => {
    const response = redirectForJumiaOAuthPersistence(makeRequest(), {
      persistence: { status: 'success', shopIds: [], isFallback: true },
    });

    const location = response.headers.get('location') ?? '';
    expect(location).toContain('error=no_shops_discovered');
    expect(location).not.toContain('success=jumia_connected');
  });

  it('redirects successful connections with newly activated shops', () => {
    const response = redirectForJumiaOAuthPersistence(makeRequest(), {
      persistence: {
        status: 'success',
        shopIds: ['shop-1'],
        isFallback: false,
      },
    });

    expect(response.headers.get('location')).toContain(
      'success=jumia_connected&shops=shop-1'
    );
  });

  it('keeps the success redirect when reconnecting already-active shops', () => {
    const response = redirectForJumiaOAuthPersistence(makeRequest(), {
      persistence: { status: 'success', shopIds: [], isFallback: false },
    });

    const location = response.headers.get('location') ?? '';
    expect(location).toContain('success=jumia_connected');
    expect(location).not.toContain('error=');
  });

  it('appends the variant outcome when provided', () => {
    const response = redirectForJumiaOAuthPersistence(makeRequest(), {
      persistence: {
        status: 'success',
        shopIds: ['shop-1'],
        isFallback: false,
      },
      variantResult: 'v1:has_refresh=true',
    });

    expect(response.headers.get('location')).toContain(
      'variant_result=v1%3Ahas_refresh%3Dtrue'
    );
  });
});
