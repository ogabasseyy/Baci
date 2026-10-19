import { describe, expect, it } from 'vitest';
import {
  getNoTrailingSlashRedirectPath,
  lowercaseStorefrontPathname,
  normalizeCacheSafeStorefrontPathname,
  normalizeLeadingPrefix,
} from './path-normalization';

describe('proxy path normalization', () => {
  it('normalizes imported punctuation without decoding safe percent escapes', () => {
    expect(
      normalizeCacheSafeStorefrontPathname('/Phones/%E2%80%9CPro%E2%80%9D')
    ).toBe('/Phones/Pro');
    expect(normalizeCacheSafeStorefrontPathname('/phones/%2Fsafe')).toBeNull();
  });

  it('preserves encoded bytes while normalizing route and trailing-slash shape', () => {
    expect(lowercaseStorefrontPathname('/Phones/%2FPRO')).toBe(
      '/phones/%2Fpro'
    );
    expect(normalizeLeadingPrefix('/API/Orders', '/api')).toBe('/api/Orders');
    expect(
      getNoTrailingSlashRedirectPath('/.well-known/acme-challenge/')
    ).toBeNull();
    expect(getNoTrailingSlashRedirectPath('/products/')).toBe('/products');
  });
});
