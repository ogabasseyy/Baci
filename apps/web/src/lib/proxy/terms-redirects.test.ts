import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import {
  buildLegacyTermsAliasRedirectResponse,
  normalizeStorefrontTermsAliasPath,
} from './terms-redirects';

describe('legacy terms redirects', () => {
  it('canonicalizes a legacy terms alias while preserving query parameters', () => {
    expect(normalizeStorefrontTermsAliasPath('/terms-and-conditions')).toBe(
      '/terms'
    );
    const response = buildLegacyTermsAliasRedirectResponse(
      new NextRequest('https://shop.example/terms-of-service?ref=email'),
      '/terms-of-service'
    );
    expect(response?.status).toBe(301);
    expect(response?.headers.get('location')).toBe(
      'https://shop.example/terms?ref=email'
    );
  });

  it('leaves the canonical terms route alone', () => {
    expect(
      buildLegacyTermsAliasRedirectResponse(
        new NextRequest('https://shop.example/terms'),
        '/terms'
      )
    ).toBeNull();
  });
});
