import { describe, expect, it } from 'vitest';
import { KNOWN_TOP_LEVEL_ROUTES } from './mobile-menu-constants';
import { resolveMobileMenuBasePath } from './resolve-mobile-menu-base-path';

describe('resolveMobileMenuBasePath', () => {
  it('uses propStoreSlug when provided, trimming surrounding slashes', () => {
    expect(resolveMobileMenuBasePath('ogabassey', undefined, '/products')).toBe(
      '/ogabassey'
    );
    expect(
      resolveMobileMenuBasePath('/ogabassey/', undefined, '/products')
    ).toBe('/ogabassey');
    expect(
      resolveMobileMenuBasePath('   /custom-store/  ', undefined, null)
    ).toBe('/custom-store');
  });

  it('returns empty string when candidate slug contains only slashes or whitespace', () => {
    expect(resolveMobileMenuBasePath('/', undefined, '/products')).toBe('');
    expect(resolveMobileMenuBasePath('   ', undefined, '/products')).toBe('');
  });

  it('falls back to merchantBasePath when propStoreSlug is undefined', () => {
    expect(
      resolveMobileMenuBasePath(undefined, 'merchant-slug', '/products')
    ).toBe('/merchant-slug');
    expect(
      resolveMobileMenuBasePath(undefined, '/merchant-slug/', null)
    ).toBe('/merchant-slug');
  });

  it('resolves base path from unknown pathname segment when neither prop nor merchant base path is passed', () => {
    expect(
      resolveMobileMenuBasePath(undefined, undefined, '/store-x/products')
    ).toBe('/store-x');
    expect(
      resolveMobileMenuBasePath(undefined, undefined, '/store-x')
    ).toBe('/store-x');
  });

  it('returns empty string when first segment of pathname is a known top-level route', () => {
    expect(resolveMobileMenuBasePath(undefined, undefined, '/products')).toBe(
      ''
    );
    expect(
      resolveMobileMenuBasePath(undefined, undefined, '/account/orders')
    ).toBe('');
    expect(resolveMobileMenuBasePath(undefined, undefined, '/cart')).toBe('');
    expect(resolveMobileMenuBasePath(undefined, undefined, '/')).toBe('');
    expect(resolveMobileMenuBasePath(undefined, undefined, null)).toBe('');
  });

  it('contains expected known top level routes', () => {
    expect(KNOWN_TOP_LEVEL_ROUTES.has('products')).toBe(true);
    expect(KNOWN_TOP_LEVEL_ROUTES.has('about')).toBe(true);
    expect(KNOWN_TOP_LEVEL_ROUTES.has('swap')).toBe(true);
    expect(KNOWN_TOP_LEVEL_ROUTES.has('repairs')).toBe(true);
  });
});
